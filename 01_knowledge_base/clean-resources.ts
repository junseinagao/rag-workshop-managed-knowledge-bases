#!/usr/bin/env npx tsx
/**
 * Module 01 のリソースをすべて削除する
 *
 * .kb-config.json を読み、データソース -> Knowledge Base -> IAMロールの順
 * (作成と逆順)で削除する。すでに存在しないリソースは警告のみで継続する。
 *
 * Usage:
 *   npx tsx 01_knowledge_base/clean-resources.ts
 */

import { BedrockAgentClient, DeleteDataSourceCommand, DeleteKnowledgeBaseCommand } from '@aws-sdk/client-bedrock-agent'
import { IAMClient, DeleteRolePolicyCommand, DeleteRoleCommand, ListRolePoliciesCommand } from '@aws-sdk/client-iam'
import { getAwsRegion } from '../shared/aws-helpers.js'
import { loadConfig, deleteConfig } from '../shared/config-store.js'
import { KB_CONFIG_PATH } from '../shared/paths.js'
import type { KnowledgeBaseConfig } from '../shared/types.js'

async function main() {
  const region = getAwsRegion()
  const config = loadConfig<KnowledgeBaseConfig>(KB_CONFIG_PATH)
  const bedrockAgent = new BedrockAgentClient({ region })
  const iam = new IAMClient({ region })

  if (config.knowledgeBaseId && config.dataSourceId) {
    try {
      console.log(`データソースを削除しています: ${config.dataSourceId}`)
      await bedrockAgent.send(
        new DeleteDataSourceCommand({
          knowledgeBaseId: config.knowledgeBaseId,
          dataSourceId: config.dataSourceId,
        }),
      )
      console.log('データソースを削除しました')
    } catch (e: any) {
      console.warn(`データソース削除をスキップ: ${e.message}`)
    }
  }

  if (config.knowledgeBaseId) {
    try {
      console.log(`Knowledge Baseを削除しています: ${config.knowledgeBaseId}`)
      await bedrockAgent.send(new DeleteKnowledgeBaseCommand({ knowledgeBaseId: config.knowledgeBaseId }))
      console.log('Knowledge Baseを削除しました')
    } catch (e: any) {
      console.warn(`Knowledge Base削除をスキップ: ${e.message}`)
    }
  }

  if (config.roleName) {
    try {
      const policies = await iam.send(new ListRolePoliciesCommand({ RoleName: config.roleName }))
      for (const policyName of policies.PolicyNames ?? []) {
        await iam.send(new DeleteRolePolicyCommand({ RoleName: config.roleName, PolicyName: policyName }))
      }
      console.log(`IAMロールを削除しています: ${config.roleName}`)
      await iam.send(new DeleteRoleCommand({ RoleName: config.roleName }))
      console.log('IAMロールを削除しました')
    } catch (e: any) {
      console.warn(`IAMロール削除をスキップ: ${e.message}`)
    }
  }

  deleteConfig(KB_CONFIG_PATH)
  console.log(`\n設定ファイルを削除しました: ${KB_CONFIG_PATH}`)
  console.log('Module 01 のクリーンアップが完了しました。')
}

main().catch((e) => {
  console.error('クリーンアップ中にエラーが発生しました:', e)
  process.exit(1)
})
