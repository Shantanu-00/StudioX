import {ImageSourcePropType} from 'react-native';

// Where a node or dossier image comes from. Images the demo packages use are
// bundled (small, licence-checked Commons thumbnails in src/assets/map/), so
// they show offline and do not depend on a third-party host answering the TV.
// Anything else loads from its https URL.
//
// Keys are the exact `image.url` strings in the packages.
const LOCAL: Record<string, ImageSourcePropType> = {
  'https://upload.wikimedia.org/wikipedia/commons/thumb/2/26/Cristiano_Ronaldo_Croatia_v_Portugal_2_July_2026-075_%28cropped%29.jpg/330px-Cristiano_Ronaldo_Croatia_v_Portugal_2_July_2026-075_%28cropped%29.jpg':
    require('../assets/map/ronaldo.jpg'),
  'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0d/Neil_Armstrong_pose.jpg/330px-Neil_Armstrong_pose.jpg':
    require('../assets/map/armstrong.jpg'),
  'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f8/Michael_Collins_%28S69-31742%2C_restoration%29.jpg/330px-Michael_Collins_%28S69-31742%2C_restoration%29.jpg':
    require('../assets/map/collins.jpg'),
  'https://upload.wikimedia.org/wikipedia/commons/thumb/d/dc/Buzz_Aldrin.jpg/330px-Buzz_Aldrin.jpg':
    require('../assets/map/aldrin.jpg'),
};

export function imageSource(url: string): ImageSourcePropType {
  return LOCAL[url] ?? {uri: url};
}
