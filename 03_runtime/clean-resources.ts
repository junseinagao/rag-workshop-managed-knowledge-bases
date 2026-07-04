#!/usr/bin/env npx tsx
/**
 * Module 03 のリソースをすべて削除する
 *
 * prepare-agent.ts はAWS CLIコマンドを画面に表示するだけで実行しないため、
 * 実際にデプロイした場合のAgent Runtime IDはこのスクリプトの引数として渡す。
 * ECRリポジトリ・IAMロールは prepare-agent.ts / デプロイ手順で使った名前の既定値を使う。
 *
 * Usage:
 *   npx tsx 03_runtime/clean-resources.ts --runtime-id <agent-runtime-id>
 *   npx tsx 03_runtime/clean-resources.ts --runtime-id <agent-runtime-id> --skip-ecr
 */

import { Command } from 'commander'
import {
  BedrockAgentCoreControlClient,
  DeleteAgentRuntimeCommand,
  GetAgentRuntimeCommand,
} from '@aws-sdk/client-bedrock-agentcore-control'
import { CloudWatchLogsClient, DeleteLogGroupCommand } from '@aws-sdk/client-cloudwatch-logs'
import { ECRClient, DeleteRepositoryCommand } from '@aws-sdk/client-ecr'
import { IAMClient, DeleteRolePolicyCommand, DeleteRoleCommand, ListRolePoliciesCommand } from '@aws-sdk/client-iam'
import { getAwsRegion } from '../shared/aws-helpers.js'

const AGENT_NAME = 'chart-agent'
const ROLE_NAME = `AgentCoreRole-${AGENT_NAME}`
const DELETION_TIMEOUT_MS = 10 * 60 * 1000

async function waitForRuntimeDeletion(control: BedrockAgentCoreControlClient, runtimeId: string): Promise<void> {
  const deadline = Date.now() + DELETION_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const resp = await control.send(new GetAgentRuntimeCommand({ agentRuntimeId: runtimeId }))
      console.log(`  削除完了を待っています... (status: ${resp.status})`)
    } catch (e: any) {
      if (e.name === 'ResourceNotFoundException') return
      throw e
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000))
  }
  console.warn('  削除完了の確認がタイムアウトしました。同名での再作成はしばらくConflictExceptionになる可能性があります')
}

async function main() {
  const program = new Command()
    .option('--runtime-id <id>', 'Agent Runtime ID (aws bedrock-agentcore-control create-agent-runtime の戻り値)')
    .option('--region <region>', 'AWSリージョン', getAwsRegion())
    .option('--skip-ecr', 'ECRリポジトリを削除しない', false)
    .option('--skip-role', 'IAMロールを削除しない', false)
    .parse()

  const { runtimeId, region, skipEcr, skipRole } = program.opts<{
    runtimeId?: string
    region: string
    skipEcr: boolean
    skipRole: boolean
  }>()

  if (runtimeId) {
    try {
      console.log(`Agent Runtimeを削除しています: ${runtimeId}`)
      const control = new BedrockAgentCoreControlClient({ region })
      await control.send(new DeleteAgentRuntimeCommand({ agentRuntimeId: runtimeId }))
      // 削除は非同期で、完了するまで同名のRuntimeを再作成するとConflictExceptionになるため完了を待つ
      await waitForRuntimeDeletion(control, runtimeId)
      console.log('Agent Runtimeを削除しました')
    } catch (e: any) {
      if (e.name === 'ResourceNotFoundException') {
        console.log('Agent Runtimeは見つかりませんでした(既に削除済み)')
      } else {
        console.warn(`Agent Runtime削除をスキップ: ${e.message}`)
      }
    }

    // RuntimeのCloudWatchロググループはRuntime削除では消えないため、明示的に削除する
    const logGroupName = `/aws/bedrock-agentcore/runtimes/${runtimeId}-DEFAULT`
    try {
      console.log(`ロググループを削除しています: ${logGroupName}`)
      const logs = new CloudWatchLogsClient({ region })
      await logs.send(new DeleteLogGroupCommand({ logGroupName }))
      console.log('ロググループを削除しました')
    } catch (e: any) {
      if (e.name === 'ResourceNotFoundException') {
        console.log('ロググループは見つかりませんでした(未作成または削除済み)')
      } else {
        console.warn(`ロググループ削除をスキップ: ${e.message}`)
      }
    }
  } else {
    console.log('--runtime-id が指定されていないため、Agent Runtimeの削除はスキップします')
  }

  if (!skipEcr) {
    try {
      console.log(`ECRリポジトリを削除しています: ${AGENT_NAME}`)
      const ecr = new ECRClient({ region })
      await ecr.send(new DeleteRepositoryCommand({ repositoryName: AGENT_NAME, force: true }))
      console.log('ECRリポジトリを削除しました')
    } catch (e: any) {
      console.warn(`ECRリポジトリ削除をスキップ: ${e.message}`)
    }
  }

  if (!skipRole) {
    try {
      const iam = new IAMClient({ region })
      const policies = await iam.send(new ListRolePoliciesCommand({ RoleName: ROLE_NAME }))
      for (const policyName of policies.PolicyNames ?? []) {
        await iam.send(new DeleteRolePolicyCommand({ RoleName: ROLE_NAME, PolicyName: policyName }))
      }
      console.log(`IAMロールを削除しています: ${ROLE_NAME}`)
      await iam.send(new DeleteRoleCommand({ RoleName: ROLE_NAME }))
      console.log('IAMロールを削除しました')
    } catch (e: any) {
      console.warn(`IAMロール削除をスキップ: ${e.message}`)
    }
  }

  console.log('\nModule 03 のクリーンアップが完了しました。')
}

main().catch((e) => {
  console.error('クリーンアップ中にエラーが発生しました:', e)
  process.exit(1)
})
