import fs from 'fs';
const content = fs.readFileSync('artifacts/halo-desktop/src/pages/PropertyDetail.tsx', 'utf8');
if(content.includes('JobFunnel')) { console.log('JobFunnel still imported/used!'); }
