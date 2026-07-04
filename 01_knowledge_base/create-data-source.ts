#!/usr/bin/env npx tsx
/**
 * Web Crawler データソースの作成 (Managed Knowledge Base)
 *
 * Managed Knowledge Base の Web Crawler コネクタは `dataSourceConfiguration.type`
 * に "MANAGED_KNOWLEDGE_BASE_CONNECTOR" を指定し、
 * `managedKnowledgeBaseConnectorConfiguration.connectorParameters` (type: "WEB") の下に
 * connectionConfiguration / crawlConfiguration / filterConfiguration を設定する。
 *
 * 重要: `seedUrls` は最大10件までしか指定できない。対象サイトの/catalogs配下の
 * 詳細ページは10件を超えるため個別のシードURLとしては指定できず、代わりに
 * `siteMapUrls`(最大3件)に対象サイトのsitemap.xmlを指定して
 * サイトマップに列挙された全URLを起点にする。sitemap.xml には詳細ページ以外の
 * ページ(トップページ、利用規約等)も含まれるため、`filterConfiguration.inclusionPatterns`
 * で `/catalogs/` 配下のみに絞り込む。さらに、sitemap.xmlに載っているが実体が
 * 404なページがある場合は `exclusionPatterns` で明示的に除外する
 * (seed-urls.ts の BROKEN_DETAIL_URLS 参照)。
 *
 * 参考: https://docs.aws.amazon.com/bedrock/latest/userguide/kb-managed-ds-webcrawler.html
 *
 * 前提: create-knowledge-base.ts を先に実行し、.kb-config.json に knowledgeBaseId が保存されていること。
 *
 * Usage:
 *   npx tsx 01_knowledge_base/create-data-source.ts
 */

import { BedrockAgentClient, CreateDataSourceCommand } from '@aws-sdk/client-bedrock-agent'
import { getAwsRegion } from '../shared/aws-helpers.js'
import { loadConfig, saveConfig } from '../shared/config-store.js'
import { KB_CONFIG_PATH } from '../shared/paths.js'
import type { KnowledgeBaseConfig } from '../shared/types.js'
import { SITEMAP_URL, CATALOG_INCLUSION_PATTERN, CATALOG_EXCLUSION_PATTERNS } from './seed-urls.js'

const DATA_SOURCE_NAME = 'sample-catalog-webcrawler'

async function main() {
  const region = getAwsRegion()
  const config = loadConfig<KnowledgeBaseConfig>(KB_CONFIG_PATH)

  if (!config.knowledgeBaseId) {
    throw new Error(
      `${KB_CONFIG_PATH} に knowledgeBaseId がありません。先に create-knowledge-base.ts を実行してください。`,
    )
  }

  const client = new BedrockAgentClient({ region })

  const response = await client.send(
    new CreateDataSourceCommand({
      knowledgeBaseId: config.knowledgeBaseId,
      name: DATA_SOURCE_NAME,
      description: '対象サイトの/catalogs配下の詳細ページを対象にしたWeb Crawlerデータソース',
      dataSourceConfiguration: {
        type: 'MANAGED_KNOWLEDGE_BASE_CONNECTOR',
        managedKnowledgeBaseConnectorConfiguration: {
          connectorParameters: {
            type: 'WEB',
            version: '1',
            connectionConfiguration: {
              siteMapUrls: [SITEMAP_URL],
              authType: 'NO_AUTH',
            },
            crawlConfiguration: {
              // 同一ホスト内のみ(サブドメインは辿らない)。サイトマップ内のURLはすべて
              // 対象サイトのため実質的な効果は inclusionPatterns によるものが大きい。
              syncScope: 'DOMAINS_ONLY',
              maxCrawledUrlsPerMinute: 50,
              crawlAttachments: false,
            },
            filterConfiguration: {
              // sitemap.xml には /catalogs/ 以外のページ(トップページ、利用規約等)も
              // 含まれるため、詳細ページのみをインデックス対象にする
              inclusionPatterns: [CATALOG_INCLUSION_PATTERN],
              // sitemap.xmlに載っているが実体が404なページ(seed-urls.ts の
              // BROKEN_DETAIL_URLS参照)をノイズとして取り込まないよう除外する
              exclusionPatterns: CATALOG_EXCLUSION_PATTERNS,
            },
          },
        },
      },
    }),
  )

  const dataSourceId = response.dataSource?.dataSourceId
  if (!dataSourceId) {
    throw new Error('CreateDataSource did not return a data source ID')
  }

  console.log(`データソースを作成しました: ${dataSourceId}`)
  console.log('Managed Knowledge Base のデータソース作成は非同期です (CREATING -> AVAILABLE)。')
  console.log('run-ingestion.ts を実行してingestionジョブを開始してください。')

  saveConfig(KB_CONFIG_PATH, { dataSourceId, dataSourceName: DATA_SOURCE_NAME })
  console.log(`設定を保存しました: ${KB_CONFIG_PATH}`)
}

main().catch((e) => {
  console.error('データソース作成に失敗しました:', e)
  process.exit(1)
})
