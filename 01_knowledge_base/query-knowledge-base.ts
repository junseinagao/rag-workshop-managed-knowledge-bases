#!/usr/bin/env npx tsx
/**
 * Knowledge Base への検索テスト (Retrieve / Agentic Retriever)
 *
 * Managed Knowledge Base では RetrieveAndGenerate は未サポート
 * (AWS公式発表で挙げられているクエリ系APIは Retrieve のみ)。
 * 複数ホップの検索・生成には代わりに AgenticRetrieveStream を使う。
 * 生成には日本リージョン内で完結する jp.anthropic.claude-sonnet-4-6
 * 推論プロファイルを使用する。
 *
 * デフォルトのクエリ一覧は `README_INTERNAL.md` (gitignore対象) の "## Sample Queries"
 * セクション(箇条書きで1行1クエリ)から読み込む。`README.md` の同名セクションをコピーして作成すること。
 *
 * Usage:
 *   npx tsx 01_knowledge_base/query-knowledge-base.ts "サービスA、B、Cの料金プランをそれぞれ教えてください"
 *   npx tsx 01_knowledge_base/query-knowledge-base.ts --mode retrieve "サービスAの料金体系"
 */

import { Command } from 'commander'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
  AgenticRetrieveStreamCommand,
} from '@aws-sdk/client-bedrock-agent-runtime'
import { getAwsRegion, getAwsAccountId, DEFAULT_MODEL_ID } from '../shared/aws-helpers.js'
import { loadConfig } from '../shared/config-store.js'
import { KB_CONFIG_PATH } from '../shared/paths.js'
import type { KnowledgeBaseConfig } from '../shared/types.js'
import { extractSection } from '../shared/markdown-sections.js'

const SAMPLE_QUERIES_HEADING = '## Sample Queries'
const HERE = dirname(fileURLToPath(import.meta.url))
const SAMPLE_QUERIES_PATH = join(HERE, 'README_INTERNAL.md')
const SAMPLE_QUERIES_EXAMPLE_PATH = join(HERE, 'README.md')

function loadDefaultQueries(): string[] {
  if (!existsSync(SAMPLE_QUERIES_PATH)) {
    throw new Error(
      `${SAMPLE_QUERIES_PATH} が見つかりません。${SAMPLE_QUERIES_EXAMPLE_PATH} の "${SAMPLE_QUERIES_HEADING}" セクションをコピーして` +
        'クエリを設定するか、クエリを引数で直接指定してください。',
    )
  }
  let section: string
  try {
    section = extractSection(readFileSync(SAMPLE_QUERIES_PATH, 'utf-8'), SAMPLE_QUERIES_HEADING)
  } catch {
    throw new Error(
      `${SAMPLE_QUERIES_PATH} に "${SAMPLE_QUERIES_HEADING}" セクションが見つかりません。${SAMPLE_QUERIES_EXAMPLE_PATH} の同名セクションをコピーして` +
        'クエリを設定するか、クエリを引数で直接指定してください。',
    )
  }
  return section
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim())
}

async function retrieveOnly(client: BedrockAgentRuntimeClient, knowledgeBaseId: string, query: string) {
  const resp = await client.send(
    new RetrieveCommand({
      knowledgeBaseId,
      retrievalQuery: { text: query },
    }),
  )
  console.log(`\nクエリ: ${query}`)
  for (const result of resp.retrievalResults ?? []) {
    const url = result.location?.webLocation?.url ?? result.location?.type
    console.log(`  - score=${result.score?.toFixed(3)} url=${url}`)
    console.log(`    ${(result.content?.text ?? '').slice(0, 120)}...`)
  }
}

async function agenticRetrieve(
  client: BedrockAgentRuntimeClient,
  knowledgeBaseId: string,
  region: string,
  accountId: string,
  query: string,
) {
  const modelArn = `arn:aws:bedrock:${region}:${accountId}:inference-profile/${DEFAULT_MODEL_ID}`
  const resp = await client.send(
    new AgenticRetrieveStreamCommand({
      messages: [{ role: 'user', content: { text: query } }],
      retrievers: [{ configuration: { knowledgeBase: { knowledgeBaseId } } }],
      agenticRetrieveConfiguration: {
        foundationModelType: 'CUSTOM',
        foundationModelConfiguration: {
          type: 'BEDROCK_FOUNDATION_MODEL',
          bedrockFoundationModelConfiguration: { modelConfiguration: { modelArn } },
        },
      },
      generateResponse: true,
    }),
  )

  console.log(`\nクエリ: ${query}`)
  for await (const event of resp.stream ?? []) {
    if (event.traceEvent) {
      console.log(`  [trace] ${event.traceEvent.attributes?.step}: ${event.traceEvent.attributes?.status}`)
      continue
    }
    if (event.result) {
      const { results = [], generatedResponse } = event.result
      console.log(`回答: ${generatedResponse?.answer}`)
      console.log('引用元:')
      for (const citation of generatedResponse?.citations ?? []) {
        for (const ref of citation.references ?? []) {
          const item = ref.resultIndex !== undefined ? results[ref.resultIndex] : undefined
          const url = item?.metadata?.['_source_uri'] ?? item?.sourceRetriever?.identifier
          console.log(`  - ${url}`)
        }
      }
      continue
    }
    const failure = event.internalServerException ?? event.validationException ?? event.resourceNotFoundException
    if (failure) {
      throw new Error(`AgenticRetrieveStream failed: ${JSON.stringify(failure)}`)
    }
  }
}

async function main() {
  const program = new Command()
    .argument('[query]', '検索クエリ(省略時はデフォルトの3件を実行)')
    .option('--mode <mode>', 'retrieve | generate', 'generate')
    .parse()

  const [query] = program.args
  const { mode } = program.opts<{ mode: string }>()

  const region = getAwsRegion()
  const config = loadConfig<KnowledgeBaseConfig>(KB_CONFIG_PATH)
  if (!config.knowledgeBaseId) {
    throw new Error(`${KB_CONFIG_PATH} に knowledgeBaseId がありません。先に 01_knowledge_base の各スクリプトを実行してください。`)
  }

  const client = new BedrockAgentRuntimeClient({ region })
  const queries = query ? [query] : loadDefaultQueries()

  if (mode === 'retrieve') {
    for (const q of queries) {
      await retrieveOnly(client, config.knowledgeBaseId, q)
    }
    return
  }

  const accountId = await getAwsAccountId(region)
  for (const q of queries) {
    await agenticRetrieve(client, config.knowledgeBaseId, region, accountId, q)
  }
}

main().catch((e) => {
  console.error('クエリ実行に失敗しました:', e)
  process.exit(1)
})
