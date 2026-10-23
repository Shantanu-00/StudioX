import {ImageSourcePropType} from 'react-native';

// Where a node or dossier image comes from. Images the demo packages use are
// bundled (small, licence-checked Commons thumbnails in src/assets/map/), so
// they show offline and do not depend on a third-party host answering the TV.
// Anything else loads from its https URL.
//
// React Native has no object-position: `cover` always keeps the middle of a
// photo, which cuts the top of a head off a portrait. So every bundled photo
// is pre-cropped around its subject: a 4:3 scene crop (480 × 360) for map
// cards and the step card, and a square face crop (320 × 320, head centred
// with headroom) for round portraits.
//
// Keys are the exact `image.url` strings in the packages.
const C = 'https://upload.wikimedia.org/wikipedia/commons/thumb';
const RONALDO = `${C}/2/26/Cristiano_Ronaldo_Croatia_v_Portugal_2_July_2026-075_%28cropped%29.jpg/330px-Cristiano_Ronaldo_Croatia_v_Portugal_2_July_2026-075_%28cropped%29.jpg`;
const ARMSTRONG = `${C}/0/0d/Neil_Armstrong_pose.jpg/330px-Neil_Armstrong_pose.jpg`;
const COLLINS = `${C}/f/f8/Michael_Collins_%28S69-31742%2C_restoration%29.jpg/330px-Michael_Collins_%28S69-31742%2C_restoration%29.jpg`;
const ALDRIN = `${C}/d/dc/Buzz_Aldrin.jpg/330px-Buzz_Aldrin.jpg`;

const LOCAL: Record<string, ImageSourcePropType> = {
  [RONALDO]: require('../assets/map/ronaldo.jpg'),
  [ARMSTRONG]: require('../assets/map/armstrong.jpg'),
  [COLLINS]: require('../assets/map/collins.jpg'),
  [ALDRIN]: require('../assets/map/aldrin.jpg'),
  // Places and things, not only people (Apollo 11, NASA, public domain).
  [`${C}/d/d5/Apollo_11_Lunar_Module_Eagle_in_landing_configuration_in_lunar_orbit_from_the_Command_and_Service_Module_Columbia.jpg/1280px-Apollo_11_Lunar_Module_Eagle_in_landing_configuration_in_lunar_orbit_from_the_Command_and_Service_Module_Columbia.jpg`]:
    require('../assets/map/eagle.jpg'),
  [`${C}/6/65/AS11-40-5962_-_Apollo_11_-_Apollo_11_Mission_image_-_Lunar_Module_at_Tranquility_Base_-_NARA_-_16685323.jpg/1280px-AS11-40-5962_-_Apollo_11_-_Apollo_11_Mission_image_-_Lunar_Module_at_Tranquility_Base_-_NARA_-_16685323.jpg`]:
    require('../assets/map/tranquility.jpg'),
  [`${C}/9/98/Aldrin_Apollo_11_original.jpg/1280px-Aldrin_Apollo_11_original.jpg`]:
    require('../assets/map/aldrin-surface.jpg'),
};

const FACE: Record<string, ImageSourcePropType> = {
  [RONALDO]: require('../assets/map/ronaldo-face.jpg'),
  [ARMSTRONG]: require('../assets/map/armstrong-face.jpg'),
  [COLLINS]: require('../assets/map/collins-face.jpg'),
  [ALDRIN]: require('../assets/map/aldrin-face.jpg'),
};

export function imageSource(url: string): ImageSourcePropType {
  return LOCAL[url] ?? {uri: url};
}

// A round portrait: the face crop when there is one, else the scene photo.
export function portraitSource(url: string): ImageSourcePropType {
  return FACE[url] ?? imageSource(url);
}
