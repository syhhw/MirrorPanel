// Renders the logo SVGs into PNGs and the Windows .ico. Run with: npm run icons
// Sizes up to 32 px use the simplified optical-size drawing; larger ones use the master.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const logo = path.join(__dirname, '..', 'design', 'logo');
const master = fs.readFileSync(path.join(logo, 'mirrorpanel-mark.svg'), 'utf8');
const small = fs.readFileSync(path.join(logo, 'mirrorpanel-mark-small.svg'), 'utf8');
const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256, 512];
const icoSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];

/** ICO container with PNG-compressed entries (supported since Windows Vista). */
function ico(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map((png) => png.data)]);
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false });
  await window.loadURL('data:text/html,<canvas></canvas>');
  const render = (svg, size) => {
    const source = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
    return window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.querySelector('canvas');
        canvas.width = canvas.height = ${size};
        const context = canvas.getContext('2d');
        context.clearRect(0, 0, ${size}, ${size});
        context.drawImage(image, 0, 0, ${size}, ${size});
        resolve(canvas.toDataURL('image/png').split(',')[1]);
      };
      image.onerror = () => reject(new Error('SVG did not load'));
      image.src = ${JSON.stringify(source)};
    })`);
  };
  const out = path.join(logo, 'png');
  fs.mkdirSync(out, { recursive: true });
  const pngs = [];
  for (const size of sizes) {
    const data = Buffer.from(await render(size <= 32 ? small : master, size), 'base64');
    fs.writeFileSync(path.join(out, `mirrorpanel-${size}.png`), data);
    if (icoSizes.includes(size)) pngs.push({ size, data });
  }
  fs.writeFileSync(path.join(logo, 'mirrorpanel.ico'), ico(pngs));
  console.log(`Icons OK: ${sizes.length} PNGs and mirrorpanel.ico`);
  app.quit();
});
