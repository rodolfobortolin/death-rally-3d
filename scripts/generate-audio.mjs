#!/usr/bin/env node
// Generates the game's sound effects and music with the ElevenLabs API.
//
// Usage:
//   ELEVENLABS_API_KEY=... node scripts/generate-audio.mjs [--force] [--only id1,id2] [--sfx-only] [--music-only]
//
// Output goes to public/audio/{sfx,music}/<id>.mp3. Existing files are skipped unless --force is given.
// The API key is read from the environment only; never commit it.

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://api.elevenlabs.io/v1';
const OUTPUT_FORMAT = 'mp3_44100_128';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'audio');

const args = process.argv.slice(2);
const force = args.includes('--force');
const sfxOnly = args.includes('--sfx-only');
const musicOnly = args.includes('--music-only');
const onlyIdx = args.indexOf('--only');
const only = onlyIdx >= 0 ? new Set(args[onlyIdx + 1]?.split(',') ?? []) : null;

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error('Missing ELEVENLABS_API_KEY environment variable.');
  process.exit(1);
}

const manifest = JSON.parse(await readFile(join(root, 'scripts', 'audio-manifest.json'), 'utf8'));

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function post(endpoint, body) {
  const res = await fetch(`${API}${endpoint}?output_format=${OUTPUT_FORMAT}`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

function generateSfx(item) {
  return post('/sound-generation', {
    text: item.prompt,
    model_id: 'eleven_text_to_sound_v2',
    duration_seconds: item.duration,
    prompt_influence: item.influence ?? 0.5,
    loop: item.loop ?? false,
  });
}

function generateMusic(item) {
  return post('/music', {
    prompt: item.prompt,
    music_length_ms: item.lengthMs,
    model_id: 'music_v1',
  });
}

const jobs = [
  ...(musicOnly ? [] : manifest.sfx.map((item) => ({ kind: 'sfx', item, run: generateSfx }))),
  ...(sfxOnly ? [] : manifest.music.map((item) => ({ kind: 'music', item, run: generateMusic }))),
].filter((job) => !only || only.has(job.item.id));

let failures = 0;
for (const { kind, item, run } of jobs) {
  const file = join(outDir, kind, `${item.id}.mp3`);
  if (!force && (await exists(file))) {
    console.log(`skip   ${kind}/${item.id} (exists)`);
    continue;
  }
  process.stdout.write(`gen    ${kind}/${item.id} ... `);
  try {
    const audio = await run(item);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, audio);
    console.log(`ok (${(audio.length / 1024).toFixed(0)} KB)`);
  } catch (err) {
    failures++;
    console.log(`FAILED\n       ${err.message}`);
  }
}

process.exit(failures > 0 ? 1 : 0);
