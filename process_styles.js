const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(path.join(dir, f));
  });
}

walkDir('artifacts/halo-desktop/src', function(filePath) {
  if (!filePath.endsWith('.tsx') && !filePath.endsWith('.ts')) return;

  let content = fs.readFileSync(filePath, 'utf8');
  let original = content;

  // Remove uppercase and tracking classes
  content = content.replace(/\buppercase\b/g, '');
  content = content.replace(/\btracking-(tight|wide|wider|widest|\[.*?\])\b/g, '');

  // Cleanup spaces in classNames
  content = content.replace(/className="([^"]*)"/g, (match, p1) => {
      const cleaned = p1.replace(/\s+/g, ' ').trim();
      return `className="${cleaned}"`;
  });
  
  // This might be risky with template literals, let's just do simple space cleanups
  content = content.replace(/ \}/g, '}').replace(/ \`/g, '`');

  // Fix placeholders
  content = content.replace(/placeholder="SEARCH PROPERTIES OR PMCS\.\.\."/g, 'placeholder="Search properties or PMCs..."');
  content = content.replace(/placeholder="SEARCH CREWS\.\.\."/g, 'placeholder="Search crews..."');
  content = content.replace(/placeholder="SEARCH (.*?)"/g, (match, p1) => {
      return `placeholder="Search ${p1.toLowerCase()}"`;
  });
  
  // We want to keep "INV-XXX" and "WO-XXX" etc uppercase, but those are values not CSS classes.

  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated ${filePath}`);
  }
});
