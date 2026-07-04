/**
 * AgentCore Runtime エントリーポイント — BedrockAgentCoreApp
 *
 * AgentCore Runtimeは以下2つのHTTPエンドポイントを要求する:
 *   GET  /ping         — ヘルスチェック
 *   POST /invocations  — エージェント呼び出し
 *
 * bedrock-agentcore/runtime の BedrockAgentCoreApp がこの2つをポート8080で
 * 自動的に提供する。
 *
 * KnowledgeBaseIdはコンテナ内にローカル設定ファイル(.kb-config.json)が
 * 存在しないため、環境変数 KNOWLEDGE_BASE_ID で渡す
 * (Agent Runtime作成時の環境変数設定、またはコンテナ起動時の -e オプションで指定)。
 *
 * 参考: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-http-protocol-contract.html
 */

import { BedrockAgentCoreApp } from 'bedrock-agentcore/runtime'
import { z } from 'zod'
import { ChartAgent } from './chart-agent/chart-agent.js'

const requestSchema = z.object({
  prompt: z.string().optional(),
  user_input: z.string().optional(),
})

const app = new BedrockAgentCoreApp({
  invocationHandler: {
    requestSchema,
    process: async (request) => {
      try {
        const userRequest = request.prompt ?? request.user_input ?? ''
        const agent = new ChartAgent({ knowledgeBaseId: process.env.KNOWLEDGE_BASE_ID })
        const result = await agent.handleRequest(userRequest)
        return { response: result.text, chart_base64_png: result.chartBase64 }
      } catch (e) {
        // フレームワークのデフォルト500応答はスタックトレースをCloudWatch Logsに残さないため、ここで明示的に出力する
        console.error('invocationの処理中にエラーが発生しました:', e)
        throw e
      }
    },
  },
})

app.run()
