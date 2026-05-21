import { readFileSync } from 'node:fs';

const htmlFiles = [
  '01_landing_page.html',
  '02_livestream_replay.html',
  '03_roofing_blueprint.html'
];

for (const file of htmlFiles) {
  const html = readFileSync(file, 'utf8');
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1])
    .filter(Boolean);

  for (const script of scripts) {
    new Function(script);
  }
}

console.log('Inline scripts parse cleanly');
