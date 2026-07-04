#!/usr/bin/env npx tsx
/**
 * Amazon Bedrock Managed Knowledge Base の作成
 *
 * Managed Knowledge Base (2026年6月GA) は、埋め込み・再ランキング・
 * ベクトルストアをすべてAWSが管理するため、Customer-managed Knowledge Base で
 * 必要だったベクトルストア(OpenSearch Serverless / S3 Vectors 等)の事前作成は不要。
 * `knowledgeBaseConfiguration.type` に "MANAGED" を指定し、
 * `storageConfiguration` は渡さない。
 *
 * 参考: https://docs.aws.amazon.com/bedrock/latest/APIReference/API_agent_CreateKnowledgeBase.html
 *       https://docs.aws.amazon.com/bedrock/latest/userguide/kb-build-managed.html
 *
 * 前提: create-iam-role.ts を先に実行し、.kb-config.json に roleArn が保存されていること。
 *
 * Usage:
 *   npx tsx 01_knowledge_base/create-knowledge-base.ts
 */

import { BedrockAgentClient, CreateKnowledgeBaseCommand, GetKnowledgeBaseCommand } from '@aws-sdk/client-bedrock-agent'
import { getAwsRegion, sleep } from '../shared/aws-helpers.js'
import { loadConfig, saveConfig } from '../shared/config-store.js'
import { KB_CONFIG_PATH } from '../shared/paths.js'
import type { KnowledgeBaseConfig } from '../shared/types.js'

const KB_NAME = 'sample-catalog-kb'

async function waitUntilActive(client: BedrockAgentClient, knowledgeBaseId: string): Promise<void> {
  for (let i = 0; i < 30; i++) {
    const resp = await client.send(new GetKnowledgeBaseCommand({ knowledgeBaseId }))
    const status = resp.knowledgeBase?.status
    if (status === 'ACTIVE') {
      console.log('Knowledge Base is ACTIVE')
      return
    }
    if (status === 'FAILED') {
      throw new Error(`Knowledge Base creation FAILED: ${resp.knowledgeBase?.failureReasons?.join(', ')}`)
    }
    console.log(`Knowledge Baseの作成を待機中... (${i + 1}/30, status: ${status})`)
    await sleep(10_000)
  }
  throw new Error('Knowledge Base did not become ACTIVE within the timeout')
}

async function main() {
  const region = getAwsRegion()
  const config = loadConfig<KnowledgeBaseConfig>(KB_CONFIG_PATH)

  if (!config.roleArn) {
    throw new Error(
      `${KB_CONFIG_PATH} に roleArn がありません。先に create-iam-role.ts を実行してください。`,
    )
  }

  const client = new BedrockAgentClient({ region })

  const response = await client.send(
    new CreateKnowledgeBaseCommand({
      name: KB_NAME,
      description: '対象サイトのカタログ詳細ページを対象にしたManaged Knowledge Base(研修用サンプル)',
      roleArn: config.roleArn,
      knowledgeBaseConfiguration: {
        type: 'MANAGED',
        managedKnowledgeBaseConfiguration: {
          // AWS既定の埋め込みモデルを使用。自前のBedrock埋め込みモデルを使いたい場合は
          // embeddingModelType: "CUSTOM" と embeddingModelArn を指定する。
          embeddingModelType: 'MANAGED',
        },
      },
      // storageConfiguration は Managed Knowledge Base では指定不要
    }),
  )

  const knowledgeBaseId = response.knowledgeBase?.knowledgeBaseId
  const knowledgeBaseArn = response.knowledgeBase?.knowledgeBaseArn
  if (!knowledgeBaseId || !knowledgeBaseArn) {
    throw new Error('CreateKnowledgeBase did not return a knowledge base ID/ARN')
  }

  console.log(`Knowledge Baseを作成しました: ${knowledgeBaseId}`)
  await waitUntilActive(client, knowledgeBaseId)

  saveConfig(KB_CONFIG_PATH, { knowledgeBaseId, knowledgeBaseArn })
  console.log(`\n完了。Knowledge Base ID: ${knowledgeBaseId}`)
  console.log(`設定を保存しました: ${KB_CONFIG_PATH}`)
}

main().catch((e) => {
  console.error('Knowledge Base作成に失敗しました:', e)
  process.exit(1)
})
