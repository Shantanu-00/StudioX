import React from 'react';
import {StyleSheet, View} from 'react-native';
import {useLink} from '../hooks/useLink';
import {useSystemToast} from '../hooks/useSystemToast';
import {colors} from '../theme';
import {cameoPackage} from './cameos';
import {MapScreen} from './MapScreen';

interface Props {
  mediaId: string;
  onClose: () => void;
  registerBack: (handler: (() => boolean) | null) => void;
}

// A cameo map from Home: an example with no video, so nothing is locked and
// there is no moment to play. BACK returns to Home.
export const CameoRoute = ({mediaId, onClose, registerBack}: Props) => {
  const link = useLink();
  const confirm = useSystemToast();
  const pkg = cameoPackage(mediaId);
  if (!pkg?.explore) {
    return null;
  }
  return (
    <View style={styles.root}>
      <MapScreen
        explore={pkg.explore}
        answers={pkg.answers ?? []}
        widgets={pkg.widgets}
        mediaId={mediaId}
        sourceTitle="Example transcript written by StudioX"
        playhead={null}
        frame={false}
        sessionId={null}
        link={link}
        confirm={confirm}
        onClose={onClose}
        registerBack={registerBack}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.black},
});
