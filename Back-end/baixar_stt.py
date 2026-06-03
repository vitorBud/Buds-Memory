from pathlib import Path
from huggingface_hub import snapshot_download

BASE = Path(__file__).resolve().parent
MODELS_DIR = BASE / "models"
MODEL_PATH = MODELS_DIR / "faster-whisper-base"

def download_model():
    print("Iniciando o download do modelo local Systran/faster-whisper-base...")

    MODELS_DIR.mkdir(exist_ok=True)

    try:
        snapshot_download(
            repo_id="Systran/faster-whisper-base",
            local_dir=str(MODEL_PATH),
            local_dir_use_symlinks=False
        )

        print("\n[OK] Download concluído com sucesso!")
        print(f"O modelo foi salvo em: {MODEL_PATH}")

    except Exception as e:
        print(f"\n[Erro] Ocorreu uma falha ao baixar o modelo do Hugging Face: {e}")

if __name__ == "__main__":
    download_model()