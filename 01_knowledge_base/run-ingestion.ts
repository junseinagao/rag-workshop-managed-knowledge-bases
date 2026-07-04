#!/usr/bin/env npx tsx
/**
 * Ingestion ジョブの実行と監視
 *
 * Managed Knowledge Base でもデータソースの同期は従来どおり
 * StartIngestionJob / GetIngestionJob API を使う(移行時にコード変更不要、という
 * Managed Knowledge Baseの設計方針どおり)。
 *
 * 前提: create-data-source.ts を先に実行し、.kb-config.json に dataSourceId が保存されていること。
 *
 * Usage:
 *   npx tsx 01_knowledge_base/run-ingestion.ts
 */

import { BedrockAgentClient, StartIngestionJobCommand, GetIngestionJobCommand } from '@aws-sdk/client-bedrock-agent'
import { getAwsRegion, sleep } from '../shared/aws-helpers.js'
import { loadConfig, saveConfig } from '../shared/config-store.js'
import { KB_CONFIG_PATH } from '../shared/paths.js'
import type { KnowledgeBaseConfig } from '../shared/types.js'

const MAX_WAIT_MS = 30 * 60_000
const POLL_INTERVAL_MS = 10_000

async function main() {
  const region = getAwsRegion()
  const config = loadConfig<KnowledgeBaseConfig>(KB_CONFIG_PATH)

  if (!config.knowledgeBaseId || !config.dataSourceId) {
    throw new Error(
      `${KB_CONFIG_PATH} に knowledgeBaseId / dataSourceId がありません。先に create-data-source.ts を実行してください。`,
    )
  }

  const client = new BedrockAgentClient({ region })

  const start = await client.send(
    new StartIngestionJobCommand({
      knowledgeBaseId: config.knowledgeBaseId,
      dataSourceId: config.dataSourceId,
    }),
  )

  const ingestionJobId = start.ingestionJob?.ingestionJobId
  if (!ingestionJobId) {
    throw new Error('StartIngestionJob did not return an ingestion job ID')
  }
  console.log(`Ingestionジョブを開始しました: ${ingestionJobId}`)
  saveConfig(KB_CONFIG_PATH, { lastIngestionJobId: ingestionJobId })

  const deadline = Date.now() + MAX_WAIT_MS
  while (Date.now() < deadline) {
    const job = await client.send(
      new GetIngestionJobCommand({
        knowledgeBaseId: config.knowledgeBaseId,
        dataSourceId: config.dataSourceId,
        ingestionJobId,
      }),
    )
    const status = job.ingestionJob?.status
    const stats = job.ingestionJob?.statistics

    if (status === 'COMPLETE') {
      console.log('\nIngestion完了')
      console.log(`  取り込み対象ドキュメント数: ${stats?.numberOfDocumentsScanned ?? '不明'}`)
      console.log(`  新規インデックス化: ${stats?.numberOfNewDocumentsIndexed ?? '不明'}`)
      console.log(`  更新: ${stats?.numberOfModifiedDocumentsIndexed ?? '不明'}`)
      console.log(`  失敗: ${stats?.numberOfDocumentsFailed ?? 0}`)
      return
    }
    if (status === 'FAILED') {
      throw new Error(`Ingestionジョブが失敗しました: ${JSON.stringify(job.ingestionJob?.failureReasons)}`)
    }

    console.log(`Ingestion進行中... (status: ${status})`)
    await sleep(POLL_INTERVAL_MS)
  }

  throw new Error(`Ingestionが ${MAX_WAIT_MS / 60_000} 分以内に完了しませんでした`)
}

main().catch((e) => {
  console.error('Ingestion実行に失敗しました:', e)
  process.exit(1)
})
