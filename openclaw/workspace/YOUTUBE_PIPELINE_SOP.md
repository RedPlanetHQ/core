# YouTube Pipeline SOP — Ross (YouTube-Planet)
# 10 exakte Schritte, 100% kostenlos

## Schritt 1: Topic Research
- Agent: Dwight (Research)
- Tool: galaxia-vector-core.py search "[niche]"
- Output: Top 3 Themen mit Suchvolumen-Schaetzung
- Kriterien: Trending, geringes Wettbewerb, monetisierbar

## Schritt 2: Script Writing
- Agent: Ross + Qwen3:32b
- Struktur:
  ```
  [Hook: 0-15 Sek — Frage oder schockierender Fakt]
  [Intro: 15-30 Sek — Wer bin ich, was lernst du]
  [Body: 3-5 Hauptpunkte mit Beispielen]
  [CTA: Subscribe + Like + Kommentar-Frage]
  [Outro: Naechstes Video teasen]
  ```
- Laenge: 8-12 Minuten optimal (Monetization sweet spot)

## Schritt 3: Thumbnail Erstellen
- Tool: thumbnail_optimizer.py
- Template: Tech Bold Red (fuer AI/Tech Niche)
- Befehl: `/thumbnail-optimizer "[Titel]" --style tech-bold-red`
- AI Critique via Ollama qwen2-vl oder llama4 (Multimodal)
- A/B Varianten: Mindestens 2

## Schritt 4: Voiceover
- Tool: Lokaler TTS (Piper TTS — kostenlos, open source)
- Stimme: Deutsch, maennlich, professionell
- Installation: `pip install piper-tts`
- Befehl: `echo "Script" | piper --model de_DE-thorsten-high --output_file voice.wav`

## Schritt 5: Stock Footage + FFmpeg Assembly
- Quellen (alle kostenlos):
  - Pexels API (kostenlos, keine Attribution noetig)
  - Pixabay (kostenlos)
  - Eigene Screen Recordings
- Assembly:
  ```bash
  ffmpeg -i voice.wav -i footage.mp4 -c:v libx264 -c:a aac output.mp4
  ```

## Schritt 6: Captions + Chapters
- Tool: Whisper (kostenlos, lokal)
- Installation: `pip install openai-whisper`
- Befehl: `whisper output.mp4 --language de --output_format srt`
- Chapters: Manuell aus Script-Struktur

## Schritt 7: YouTube Upload
- Tool: youtube-studio-uploader Skill (Browser Automation)
- Metadata:
  - Titel: Max 60 Zeichen, Keyword vorne
  - Description: 3000+ Zeichen, Links, Chapters, Keywords
  - Tags: 15-20 relevante Tags
  - Thumbnail: Beste A/B Variante

## Schritt 8: Shorts-Clips + Cross-Promo
- 3 Shorts aus jedem Video schneiden (60 Sek max)
- Cross-Post: X (Kelly), Instagram Reels, TikTok
- Befehl: `ffmpeg -ss 00:01:30 -t 00:00:59 -i output.mp4 short1.mp4`

## Schritt 9: Monetization-Tracking
- Revenue in REVENUE-LOG.md eintragen
- Planet: YouTube-Planet-[Nr]
- Metriken: Views, Watch Time, CTR, Revenue

## Schritt 10: Self-Review + Planet-Spawn
- Monica reviewt Performance nach 48h
- Bei Erfolg: Spawn YouTube-Planet-[Nr+1]
- Bei Misserfolg: Dwight analysiert, Script/Thumbnail optimieren
- Exponentielles Wachstum: Jedes Video besser als das letzte

## Tools Summary (alle kostenlos)
| Tool | Zweck | Installation |
|------|-------|-------------|
| Piper TTS | Voiceover | `pip install piper-tts` |
| Whisper | Untertitel | `pip install openai-whisper` |
| FFmpeg | Video-Editing | `apt install ffmpeg` |
| Pillow | Thumbnails | `pip install pillow` |
| yt-dlp | Research | `pip install yt-dlp` |
| Pexels API | Stock Footage | Kostenloser API Key |
