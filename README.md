# AR AI — MVP

Мобильное AR-приложение: камера как фон, 3D VRM-аватар поверх реальности, голосовой диалог с AI.

## Быстрый старт

### 1. Установить зависимости

```bash
npm install
```

### 2. Создать файл `.env`

```bash
cp .env.example .env
```

Открой `.env` и вставь свой ключ OpenRouter:
```
VITE_OPENROUTER_API_KEY=sk-or-xxxxxxxxxxxxxxxx
```

Получить ключ: https://openrouter.ai/keys

### 3. Запустить

```bash
npm run dev
```

Открой в браузере: http://localhost:5173

### 4. Тест на телефоне

```bash
npm run dev -- --host
```

Открой на телефоне по адресу вида `http://192.168.x.x:5173`

> ⚠️ На физическом устройстве камера и SpeechRecognition требуют HTTPS.
> Для локальной разработки используй [ngrok](https://ngrok.com/) или [mkcert](https://github.com/FiloSottile/mkcert).

## Деплой на GitHub Pages (HTTPS — работает на телефоне)

### 1. Создай репозиторий на GitHub и запушь код

```bash
git init
git add .
git commit -m "init: AR AI MVP"
git remote add origin https://github.com/<твой-логин>/<имя-репо>.git
git push -u origin main
```

### 2. Добавь API-ключ как GitHub Secret

`Settings` → `Secrets and variables` → `Actions` → `New repository secret`

```
Name:  VITE_OPENROUTER_API_KEY
Value: sk-or-xxxxxxxxxxxxxxxx
```

### 3. Включи GitHub Pages

`Settings` → `Pages` → **Source: GitHub Actions**

### 4. Готово

При каждом `git push` GitHub автоматически собирает и публикует приложение по адресу:

```
https://<твой-логин>.github.io/<имя-репо>/
```

Этот URL работает с HTTPS — камера и SpeechRecognition будут работать на любом телефоне.

---

> ⚠️ **Безопасность**: API-ключ встраивается в собранный JS-файл.
> Это нормально для MVP/демо, но установи лимиты на расход в панели OpenRouter.

---

## Структура

```
src/
  main.js    — инициализация, оркестрация
  avatar.js  — Three.js + VRM загрузка и idle-анимация
  ai.js      — OpenRouter API, история диалога
  voice.js   — SpeechRecognition + SpeechSynthesis
style.css    — cyberpunk glassmorphism UI
index.html   — разметка
```

## Расширение в будущем

| Фича | Файл |
|------|------|
| Память AI | `ai.js` — `history[]` уже есть |
| Эмоции аватара | `avatar.js` — `playExpression(name)` |
| Несколько персонажей | Добавить `characters.js`, параметр в `loadAvatar()` |
| AR позиционирование | Заменить camera background на WebXR |
| Другой голос | `voice.js` — поменять `LANG` и логику `pickVoice()` |
| Другая LLM модель | `ai.js` — константа `MODEL` |
