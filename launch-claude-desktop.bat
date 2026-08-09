@echo off
echo Starting AgentRouter local compatibility proxy...
start /b node "%~dp0agentrouter-proxy.js"
set ANTHROPIC_API_KEY=sk-6oEZt0BCzNi4xfI9T14zMCgfr7UlTSJ0XlgiJkYj7QMBudKC
set ANTHROPIC_BASE_URL=http://127.0.0.1:3456
set ANTHROPIC_MODEL=claude-opus-5

if exist "%LOCALAPPDATA%\Programs\Claude\Claude.exe" (
    echo Launching Claude Desktop App...
    start "" "%LOCALAPPDATA%\Programs\Claude\Claude.exe"
) else (
    echo Environment variables set! Open Claude Desktop from your Start Menu or Desktop shortcut.
)
