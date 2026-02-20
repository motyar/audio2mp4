#!/usr/bin/env python3
"""
transcribe.py — Transcribe audio using faster-whisper and output word-level timestamps as JSON.
"""

import argparse
import json
import os
import sys


def transcribe(audio_path, output_path, model_size="small", language=None):
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("ERROR: faster-whisper is not installed. Run: pip install faster-whisper", file=sys.stderr)
        sys.exit(1)

    if not os.path.exists(audio_path):
        print(f"ERROR: Audio file not found: {audio_path}", file=sys.stderr)
        sys.exit(1)

    print(f"Loading Whisper model: {model_size} (device=cpu, compute_type=int8)")
    model = WhisperModel(model_size, device="cpu", compute_type="int8")

    transcribe_kwargs = {"word_timestamps": True}
    if language and language != "auto":
        transcribe_kwargs["language"] = language

    print(f"Transcribing: {audio_path}")
    segments, info = model.transcribe(audio_path, **transcribe_kwargs)

    detected_language = info.language
    language_probability = info.language_probability
    print(f"Detected language: {detected_language} (probability: {language_probability:.3f})")

    words = []
    for segment in segments:
        if segment.words:
            for w in segment.words:
                word_text = w.word.strip()
                if word_text:
                    words.append({
                        "word": word_text,
                        "start": round(w.start, 3),
                        "end": round(w.end, 3)
                    })

    if not words:
        print("WARNING: No words detected in audio (silence or music-only section).", file=sys.stderr)

    output = {
        "language": detected_language,
        "language_probability": round(language_probability, 3),
        "words": words
    }

    os.makedirs(os.path.dirname(output_path) if os.path.dirname(output_path) else ".", exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"Wrote {len(words)} words to {output_path}")


def main():
    parser = argparse.ArgumentParser(description="Transcribe audio to word-level timestamps using faster-whisper")
    parser.add_argument("--audio", required=True, help="Path to audio file (mp3/wav/m4a/ogg)")
    parser.add_argument("--output", required=True, help="Path to output JSON file")
    parser.add_argument("--model", default="small", choices=["tiny", "base", "small", "medium", "large"],
                        help="Whisper model size (default: small)")
    parser.add_argument("--language", default="auto",
                        help="Language code (e.g. 'en', 'es') or 'auto' for auto-detection (default: auto)")
    args = parser.parse_args()

    transcribe(args.audio, args.output, model_size=args.model, language=args.language)


if __name__ == "__main__":
    main()
