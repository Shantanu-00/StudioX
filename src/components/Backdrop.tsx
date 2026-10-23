import React, {useEffect, useRef, useState} from 'react';
import {
  Animated,
  Image,
  ImageSourcePropType,
  StyleSheet,
  View,
} from 'react-native';
import {colors} from '../theme';

interface Layer {
  key: string;
  source: ImageSourcePropType;
}

// Full-bleed hero art that cross-fades when the focused item changes. At most
// two images are mounted (outgoing and incoming); the outgoing one is dropped
// as soon as the fade completes. Opacity runs on the native driver.
export const Backdrop = ({
  id,
  source,
}: {
  id: string;
  source: ImageSourcePropType;
}) => {
  const [layers, setLayers] = useState<Layer[]>([{key: id, source}]);
  const fade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (layers[layers.length - 1].key === id) {
      return;
    }
    setLayers((prev) => [prev[prev.length - 1], {key: id, source}]);
    fade.setValue(0);
    const anim = Animated.timing(fade, {
      toValue: 1,
      duration: 360,
      useNativeDriver: true,
    });
    anim.start(({finished}) => {
      if (finished) {
        setLayers((prev) => prev.slice(-1));
      }
    });
    return () => anim.stop();
    // `layers` is read only to skip no-op changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, source, fade]);

  return (
    <View style={styles.root} pointerEvents="none">
      {layers.map((layer, i) => {
        const incoming = i === layers.length - 1 && layers.length > 1;
        return (
          <Animated.View
            key={layer.key}
            style={[StyleSheet.absoluteFill, incoming && {opacity: fade}]}>
            <Image
              source={layer.source}
              style={styles.image}
              resizeMode="cover"
            />
          </Animated.View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {...StyleSheet.absoluteFillObject, backgroundColor: colors.black},
  image: {width: '100%', height: '100%'},
});
