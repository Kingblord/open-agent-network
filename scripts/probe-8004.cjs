// TEMP diagnostic: inspect the real 8004scan.io response shape. Not part of the app.
const https = require('node:https');

const opts = {
  hostname: '8004scan.io',
  path: '/api/v1/agents',
  headers: {
    'X-API-Key': '8004_5SYV0HLuTOGDK8EiAFztKmEZWylVIxgh_b7831cf8',
    Accept: 'application/json',
  },
};

https.get(opts, (res) => {
  let body = '';
  res.on('data', (d) => (body += d));
  res.on('end', () => {
    console.log('STATUS', res.statusCode, res.headers['content-type'] || '');
    console.log('BODY HEAD (first 1200 chars):');
    console.log(body.slice(0, 1200));
    try {
      const j = JSON.parse(body);
      console.log('\nTOP-LEVEL KEYS:', Object.keys(j));
      if (Array.isArray(j)) {
        console.log('IS ARRAY, length', j.length);
        if (j[0]) console.log('first item keys:', Object.keys(j[0]));
      } else {
        for (const k of Object.keys(j)) {
          const v = j[k];
          console.log(`  ${k} ->`, Array.isArray(v) ? `array len ${v.length}` : v && typeof v === 'object' ? 'object' : JSON.stringify(v).slice(0, 100));
        }
      }
    } catch (e) {
      console.log('NOT VALID JSON');
    }
  });
}).on('error', (e) => console.log('ERR', e.message));