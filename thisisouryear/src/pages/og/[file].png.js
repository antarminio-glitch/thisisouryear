// Builds one share card picture per city. See src/lib/og.js.
import teams from '../../data/teams.json';
import history from '../../data/history.json';
import palettes from '../../data/palettes.json';
import { counterFor, todayIn } from '../../lib/counter.js';
import { cardKey, cardPng } from '../../lib/og.js';
import { placeName } from '../../lib/cities.js';

export function getStaticPaths() {
  const today = todayIn();
  return teams.map((team) => {
    const counter = counterFor(team.slug, placeName(team), history, today);
    return { params: { file: `${team.slug}-${cardKey(team, counter.text, undefined, palettes.version)}` }, props: { team, text: counter.text } };
  });
}

export async function GET({ props, site }) {
  const png = await cardPng(props.team, props.text, undefined, site?.host);
  return new Response(png, { headers: { 'Content-Type': 'image/png' } });
}
