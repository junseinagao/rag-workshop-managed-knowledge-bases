FROM node:24-slim

WORKDIR /app

# 依存関係のインストール
COPY 03_runtime/deployment/package.json ./package.json
COPY 03_runtime/deployment/tsconfig.json ./tsconfig.json
RUN npm install

# 相対importが正しく解決されるようにファイルを配置する:
#   agent/index.ts -> ./chart-agent/...                    ✓
#   agent/chart-agent/chart-agent.ts -> ../../shared/...   -> /app/shared/ ✓
COPY 03_runtime/deployment/index.ts ./agent/
COPY 02_chart_agent/chart-agent/ ./agent/chart-agent/
COPY shared/ ./shared/

# TypeScriptをビルド
RUN npx tsc

EXPOSE 8080

CMD ["node", "dist/agent/index.js"]
