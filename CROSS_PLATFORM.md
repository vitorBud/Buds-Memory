# Nexus cross-platform notes

This project is meant to run on Windows and macOS without changing the frontend API.

## Backend

Run the Flask backend from `Back-end`:

```powershell
python -m pip install -r requirements.txt
python baixar_stt.py
python app.py
```

The backend listens on `http://localhost:5000`.

## Frontend

Run the React/Vite frontend from `front-end`:

```powershell
npm install
npm run dev
```

On Windows PowerShell, if `npm run dev` is blocked by execution policy, use:

```powershell
npm.cmd run dev
```

The frontend uses the Vite proxy in `front-end/vite.config.ts` to send `/api` calls to the Flask backend.

## Piper TTS

The backend resolves Piper in this order:

1. `NEXUS_PIPER_BIN` environment variable
2. Bundled executable in `Back-end/piper`
   - Windows: `piper.exe`
   - macOS/Linux: `piper`
3. `piper` available in `PATH`

Examples:

```powershell
$env:NEXUS_PIPER_BIN="C:\path\to\piper.exe"
python app.py
```

```bash
export NEXUS_PIPER_BIN="/path/to/piper"
python app.py
```

The voice model remains shared across platforms:

```text
Back-end/voz/pt_BR-faber-medium.onnx
Back-end/voz/pt_BR-faber-medium.onnx.json
```

## Health check

Use this endpoint to see what the backend detected:

```text
http://localhost:5000/api/health
```

It reports the platform, selected Piper binary, voice model availability, STT model availability, and Ollama model name.

## Notes

- Ollama must be running locally before chat generation works.
- Audio transcription loads `faster-whisper` only when audio is actually sent.
- Text-only chat can start even if the STT model has not been downloaded yet.
