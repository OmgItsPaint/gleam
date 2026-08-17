const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

async function atomicWrite(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(temporary, value);
  await fsp.rename(temporary, file);
}

module.exports = { atomicWrite };
