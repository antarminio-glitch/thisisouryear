// Builds the print files the print-on-demand service prints from: one per
// city, for each design that's live. See src/lib/print-file.js.
import teams from '../../data/teams.json';
import catalog from '../../data/catalog.json';
import { printFileName, printPng } from '../../lib/print-file.js';

export function getStaticPaths() {
  const designs = catalog.designs.filter((d) => d.status === 'live');
  return teams.flatMap((team) =>
    designs.map((design) => ({ params: { file: printFileName(team, design).replace(/\.png$/, '') }, props: { team, design } })),
  );
}

export async function GET({ props }) {
  return new Response(await printPng(props.team, props.design), { headers: { 'Content-Type': 'image/png' } });
}
