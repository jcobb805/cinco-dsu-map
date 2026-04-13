/**
 * Build cinco-dsu-map/private.html from index.html.
 * Adds:
 *   1. CryptoJS library include
 *   2. Password prompt overlay
 *   3. Encrypted economics JSON loader (sets WELL_ECON on success)
 *
 * Run: node build-private.js
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'index.html');
const OUT = path.join(__dirname, 'private.html');

let html = fs.readFileSync(SRC, 'utf8');

// 1. Update title
html = html.replace(/<title>[^<]*<\/title>/, '<title>Cinco DSU Map (Private - With Economics)</title>');

// 2. Inject CryptoJS CDN before </head>
const cryptoCdn = '<script src="https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.2.0/crypto-js.min.js"></script>';
html = html.replace('</head>', cryptoCdn + '\n</head>');

// 3. Inject password gate overlay HTML right after <body>
const gateHtml = `
<div id="econ-gate" style="position:fixed;top:0;left:0;width:100vw;height:100vh;background:#0f1923;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:'Segoe UI',sans-serif;color:#e0e0e0;">
  <div style="background:#1b2a3d;border-radius:12px;padding:36px 44px;min-width:340px;text-align:center;box-shadow:0 8px 24px rgba(0,0,0,.4);">
    <div style="color:#d4a84b;font-size:22px;font-weight:600;margin-bottom:8px;">Cinco DSU Map</div>
    <div style="color:#8899aa;font-size:13px;margin-bottom:20px;">Private — With Economics Overlay</div>
    <input id="econ-pwd" type="password" placeholder="Password" autofocus
      style="width:100%;background:#0f1923;color:#e0e0e0;border:1px solid #2a3a4d;padding:10px 14px;border-radius:6px;font-size:14px;font-family:Arial;margin-bottom:12px;outline:none;"
      onkeydown="if(event.key==='Enter')window.unlockEcon()">
    <button onclick="window.unlockEcon()"
      style="width:100%;background:#d4a84b;color:#0f1923;border:none;padding:10px 16px;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;">Unlock</button>
    <div id="econ-err" style="color:#ff6b6b;font-size:12px;margin-top:10px;display:none;">Invalid password</div>
  </div>
</div>
<script>
window.WELL_ECON = {};
window.unlockEcon = function() {
  const pwd = document.getElementById('econ-pwd').value;
  if (!pwd) return;
  const errEl = document.getElementById('econ-err');
  errEl.style.display = 'none';
  fetch('well-economics.json.enc')
    .then(r => r.ok ? r.text() : Promise.reject('Could not load economics file'))
    .then(enc => {
      try {
        const decrypted = CryptoJS.AES.decrypt(enc, pwd).toString(CryptoJS.enc.Utf8);
        if (!decrypted) throw new Error('empty');
        const data = JSON.parse(decrypted);
        window.WELL_ECON = data;
        try { sessionStorage.setItem('cincoEconPwd', pwd); } catch(e){}
        document.getElementById('econ-gate').style.display = 'none';
        if (typeof renderAll === 'function') renderAll();
      } catch(e) {
        errEl.textContent = 'Invalid password';
        errEl.style.display = 'block';
      }
    })
    .catch(err => {
      errEl.textContent = String(err);
      errEl.style.display = 'block';
    });
};
// Auto-unlock if previously authenticated this session
(function(){
  try {
    const saved = sessionStorage.getItem('cincoEconPwd');
    if (saved) {
      document.getElementById('econ-pwd').value = saved;
      window.unlockEcon();
    }
  } catch(e){}
})();
</script>
`;
html = html.replace('<body>', '<body>\n' + gateHtml);

fs.writeFileSync(OUT, html, 'utf8');
console.log('Built: ' + OUT);
console.log('Size:  ' + (fs.statSync(OUT).size/1024).toFixed(1) + ' KB');
