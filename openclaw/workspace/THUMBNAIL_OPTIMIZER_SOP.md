# Thumbnail Optimizer SOP
# 100% kostenlos: Pillow + Ollama Multimodal Critique

## Workflow
1. Generiere Thumbnail mit Pillow (Python)
2. AI Critique mit Ollama Multimodal (llama4 oder qwen2-vl)
3. Optimiere basierend auf Feedback
4. A/B Varianten erstellen
5. Beste Variante fuer Upload waehlen

## Styles
| Style | Farben | Font | Nutzen |
|-------|--------|------|--------|
| tech-bold-red | Rot/Schwarz/Weiss | Impact Bold | AI, Tech, Coding |
| money-green | Gruen/Gold/Schwarz | Montserrat Bold | Finance, Trading |
| clean-minimal | Weiss/Blau/Grau | Helvetica | Tutorial, How-To |
| shock-yellow | Gelb/Schwarz/Rot | Anton Bold | Clickbait, Viral |

## Befehl
```bash
python3 thumbnail_optimizer.py --title "Dein Video Titel" --style tech-bold-red --output thumb.png
```

## Critique-Prompt (fuer Ollama Multimodal)
```
Analysiere dieses YouTube Thumbnail:
1. Ist der Text lesbar auf mobilen Geraeten?
2. Ist das Farbschema aufmerksamkeitsstark?
3. Gibt es einen klaren Fokuspunkt?
4. Wuerdest du darauf klicken? Warum/warum nicht?
5. Bewertung 1-10 mit konkreten Verbesserungsvorschlaegen.
```

## Best Practices
- Max 4-5 Woerter auf Thumbnail
- Gesicht/Emotion wenn moeglich
- Kontrast: Hell auf Dunkel oder umgekehrt
- Mobile-First: Muss auf 120x67px erkennbar sein
- Nie Clickbait ohne Delivery im Video
