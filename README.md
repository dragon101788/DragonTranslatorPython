# 龙腾翻译 (Dragon Translator)

Python 版本的桌面翻译应用，基于 pywebview + React。

## 功能

- **LLM 翻译**: 支持 OpenAI 兼容 API（远程 + 本地 llamafile）
- **离线翻译**: Bergamot NMT 引擎（WASM，浏览器内运行）
- **TTS 语音朗读**: Piper 神经网络 TTS 引擎
- **智能体管理**: 自定义翻译提示词智能体
- **翻译历史**: 本地 JSON 文件持久化
- **全局快捷键**: 一键唤出/隐藏窗口
- **系统托盘**: 最小化到托盘
- **绿色便携**: 单文件夹，不写注册表

## 快速开始

### 开发模式

```bash
# 1. 安装 Python 依赖
pip install -r requirements.txt

# 2. 构建前端
cd frontend
npm install
npm run build
cd ..

# 3. 运行
python -m dragon_translator
```

### 打包

```bash
# 使用 PyInstaller 打包为便携文件夹
pip install pyinstaller
pyinstaller DragonTranslator.spec

# 输出在 dist/DragonTranslator/
```

或直接运行：
```bash
build.bat
```

## 项目结构

```
├── dragon_translator/     # Python 后端
│   ├── app.py            # 核心应用 (pywebview 窗口, JS API)
│   ├── paths.py          # 路径解析
│   ├── logger.py         # 文件日志
│   ├── user_files.py     # 配置播种
│   ├── tts.py            # TTS (Piper 子进程)
│   ├── llama_manager.py  # 本地 LLM 管理
│   └── single_instance.py # 单实例互斥体
├── frontend/             # React 前端源码
│   └── src/services/bridge.ts  # pywebview ↔ Tauri 适配层
├── web/                  # 前端构建产物
├── runtime/              # 运行时资源 (Piper, llamafile, 模型)
├── config.json           # 用户配置 (自动创建)
├── logs/                 # 运行时日志
└── requirements.txt      # Python 依赖
```

## 依赖

- Python >= 3.11
- pywebview >= 5.0 (桌面 WebView)
- pystray (系统托盘)
- pywin32 (Win32 API)
- PyAudio (音频播放)
- httpx (HTTP 下载)

## 技术架构

```
React 前端 (WebView)  ←→  Python 后端 (JS API Bridge)
                              ↓
                    ┌─────────┼─────────┐
                    ↓         ↓         ↓
                 Piper     llamafile  文件系统
                 (TTS)     (本地LLM)   (JSON配置)
```

从 Rust/Tauri v2 迁移而来，保留了全部功能和"绿色便携"理念。
