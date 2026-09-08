# Talking Avatar — Class Install Guide

A step-by-step guide for people who have never used a terminal. By the end you will have a photoreal avatar on your screen that listens to your microphone, thinks with Claude, and talks back with moving lips. Budget about 45 minutes, most of it waiting on account sign-ups.

Nothing here is typed into an AI. You do every step yourself.

---

## Part A — Requirements

### Hardware

- [ ] A laptop or desktop: Mac (any from the last 8 years), Windows 10 or 11, or Linux.
- [ ] **Headphones or earbuds.** Not optional. Without them the avatar hears its own voice through your speakers and talks to itself.
- [ ] A microphone. The one built into your laptop is fine.
- [ ] Internet. Video streams from Anam's servers, so a wired or strong Wi-Fi connection matters.

### Accounts (free, but sign up before class; email verification takes time)

- [ ] **Anam** at https://anam.ai — renders the avatar. Sign up, then open Anam Lab at https://lab.anam.ai.
- [ ] **Deepgram** at https://console.deepgram.com — does the listening, the thinking (Claude), and the voice. New accounts get free credit; no card needed.
- [ ] You do **not** need an Anthropic or OpenAI account. Deepgram calls Claude for you.

### Software

- [ ] **Google Chrome.** Other browsers may work, but the class is tested on Chrome.
- [ ] **Node.js** version 20 or newer, from https://nodejs.org (choose the "LTS" download). Installed in Step 1 below.
- [ ] Optional: a **plain-text editor** such as Visual Studio Code (https://code.visualstudio.com), only if you want to write your own characters later.
- [ ] The project files, downloaded from https://github.com/danasacco-beep/talking-avatar-starter in Step 2 below.

### Vocabulary you will meet

| Word | Meaning |
| --- | --- |
| Terminal | A window where you type commands. Mac: the app called Terminal. Windows: PowerShell. |
| API key | A long password that lets the app use a service on your behalf. Treat it like a password. |
| `.env` file | A small text file where the app reads your keys. It starts with a dot, so it's hidden by default. |
| localhost | Your own computer, as seen by your browser. |

---

## Part B — Install, step by step

### Step 1 — Install Node.js

1. Go to https://nodejs.org and click the big **LTS** download button.
2. Open the downloaded installer and click through with the defaults.
3. Open a terminal:
   - **Mac:** press `Cmd + Space`, type `Terminal`, press Enter.
   - **Windows:** press the Windows key, type `PowerShell`, press Enter.
4. Type this and press Enter:

```
node -v
```

**You should see** a version number starting with `v20`, `v22`, or higher, for example `v22.11.0`.
If you see "command not found," close the terminal, open it again, and retry. If it still fails, the installer didn't finish; run it again.

### Step 2 — Download the project

1. Go to **https://github.com/danasacco-beep/talking-avatar-starter**
2. Click the green **Code** button, then **Download ZIP**. You get a file called `talking-avatar-starter-main.zip`.
3. Move that file to your **Desktop** and double-click it. You get a folder called `talking-avatar-starter-main`.
4. **Rename that folder to exactly `talking-avatar`.** The commands later in this guide assume that name, so this step is not optional.
5. Open it and check it contains `server.js`, a `public` folder, a `prompts` folder, and a file called `.env.example`.
   - **Can't see `.env.example`?** It's hidden. Mac: press `Cmd + Shift + .` in Finder. Windows: View menu → Show → Hidden items.

**Prefer git?** `git clone https://github.com/danasacco-beep/talking-avatar-starter.git ~/Desktop/talking-avatar` does the same thing in one line.

### Step 3 — Get your Anam API key

1. Sign in at https://lab.anam.ai.
2. Find **API Keys** in the left menu (under your account or settings).
3. Click **Create** (or **New API key**), give it any name like `class`, and copy the key.
4. Paste it somewhere safe for a moment, like a new note. You'll need it in Step 5.

### Step 4 — Get your Deepgram API key

1. Sign in at https://console.deepgram.com.
2. In the left menu click **API Keys**, then **Create a New API Key**.
3. Name it `class`, leave the permission as **Member**, and click **Create Key**.
4. **Copy it now.** Deepgram shows a key only once. If you lose it, just create another.

### Step 5 — Install the app's dependencies

1. In the terminal, move into the project folder. Type this and press Enter:

   Mac:
   ```
   cd ~/Desktop/talking-avatar
   ```
   Windows:
   ```
   cd $HOME\Desktop\talking-avatar
   ```

2. Install what the app needs:

```
npm install
```

**You should see** a few lines of progress and then something like `added 80 packages` and `found 0 vulnerabilities`. It takes under a minute. A new folder called `node_modules` appears; that's normal.

### Step 6 — Start the app

```
npm start
```

**You should see** exactly these four lines and nothing else:

```
Talking Avatar is running.
Open this in Chrome:  http://localhost:4400
Then paste your Anam and Deepgram API keys into the box at the top of the page.
Press Ctrl+C here to stop.
```

The third line is a to-do list for you: it appears only while a key is still missing, so once you
have saved both keys in Step 7 it stops showing. If instead you see `Port 4400 is already in use`,
follow the line's own advice — close whatever else is running, or put `PORT=4401` in `.env`.

Leave this terminal window open. The app runs as long as it stays open.

### Step 7 — Open it in Chrome and paste your keys

1. Open Chrome and go to: **http://localhost:4400**
2. Chrome asks to use your microphone. Click **Allow**.
3. On the right-hand side of the page, the first card is **1 API keys**. Paste your Anam key in the first field and your Deepgram key in the second, then click **Save keys**.

**You should see** "Saved. Keys verified and written to .env." and the label change to "Both keys saved." The Avatar and Voice lists fill in a moment later.

If it says a key was rejected, you pasted it with extra spaces, or it's the wrong key. Make a new one (Steps 3–4) and paste again. The keys are saved to a hidden file called `.env` in the project folder, so you only do this once.

### Step 8 — Talk

1. Put your **headphones on**.
2. On the page:
   - **Avatar:** pick anyone you like. Their portrait appears in the video box.
   - **Voice:** pick how the avatar sounds. Press the ▶ button to hear a sample.
   - **Secret figure:** type a real historical figure, for example `Leonardo da Vinci`. Have a partner type it so you don't know the answer.
   - **Microphone:** pick your mic. Say something; the green bar under it should jump.
3. Click **Start conversation**.

**You should see** the status turn green and say "Listening," the avatar come alive, and hear it greet you in character. Then just talk. Ask it questions and try to guess who it is. Interrupting it is fine; it stops and listens.

4. Click **Stop** when you're done. To quit the app entirely, go back to the terminal and press `Ctrl + C`.

---

## Part C — Make it yours

### Change what the character says

Open the `prompts` folder. Each `.md` file is the personality and instructions for one character, written in plain English. Edit one, save it, and reload the page. No restart needed.

### Add a new character

1. Create a new file in `prompts`, for example `pirate.md`, and write the instructions.
2. Open `prompts/index.json` and add an entry inside the square brackets, after a comma:

   ```json
   { "id": "pirate", "name": "Pirate captain", "file": "pirate.md", "greeting": "Ahoy! Who goes there?" }
   ```

3. Reload the page. The new character appears in the dropdown.

Write `"kickoff"` instead of `"greeting"` if you want the character to compose its own opening line each time. Write `[SOME_NAME]` in the prompt and list it under `"fields"` to get a fill-in box on the page, the way the mystery game does.

### Change the voice or model

Open `.env`. `SPEAK_MODEL` is the voice (Deepgram lists them at https://developers.deepgram.com/docs/tts-models). `THINK_MODEL` is the Claude model. Restart the app after changing `.env` (Ctrl + C, then `npm start`).

---

## Part D — Troubleshooting

| What you see | What it means | Fix |
| --- | --- | --- |
| `npm: command not found` | Node.js isn't installed or the terminal is stale | Do Step 1 again; close and reopen the terminal |
| `No such file or directory` after `cd` | The folder isn't on the Desktop or isn't named `talking-avatar` | Check the folder's name and location |
| `Deepgram connection failed: Unexpected server response: 401` | Deepgram key is wrong or missing | Paste a fresh key in the API keys box and Save |
| `Anam session failed` | Anam key is wrong, or the avatar isn't available | Paste a fresh key in the API keys box and Save; try a different avatar |
| `EADDRINUSE` or "port already in use" | Something else is using port 4400 | Change `PORT=4400` in `.env` to `4401`, restart, and open that address |
| "This site can't be reached" in Chrome | The app isn't running | Look at the terminal; run `npm start` again |
| Microphone list is empty or says "Microphone 1" | Chrome hasn't been given permission | Click the camera/mic icon in Chrome's address bar → Allow, then click **Allow mic** on the page |
| The avatar keeps talking to itself | It hears its own voice | Wear headphones |
| Green level bar never moves | Wrong microphone selected, or muted | Pick another mic in the dropdown; check system input volume |
| Lips move but no sound | Chrome tab muted, or output device wrong | Check the tab's speaker icon and your system output |
| "Both keys needed" and Start is greyed out | No keys saved yet | Do Step 7 |
| Long pause, then "Failed to think" | Deepgram couldn't reach Claude | Check Deepgram credit at console.deepgram.com; try again |

---

## For the instructor

- **Before class:** have students create both accounts and verify their email at home. Sign-ups are the slowest part.
- **Distribute** the repo link: https://github.com/danasacco-beep/talking-avatar-starter — it contains no keys, only `.env.example` with blank fields.
- **Timing:** Steps 1–2 about 10 minutes, keys 10 minutes, Steps 5–8 about 10 minutes, leaving time to play.
- **Room setup:** headphones for everyone; a room of open speakers becomes a feedback chorus.
- **Cost:** Deepgram's free credit covers the class many times over. Anam bills by avatar streaming minutes on its free tier; ask students to press Stop when not talking.
- **Privacy:** speech goes to Deepgram and Anam's servers. Say so up front.
