import React from 'react';
import {StyleSheet, View} from 'react-native';
import {NavRail, Tab} from '../components/NavRail';
import {Episode} from '../data/episodes';
import {LinkSection} from './sections/LinkSection';
import {SharedSection} from './sections/SharedSection';
import {WatchSection} from './sections/WatchSection';

interface Props {
  tab: Tab;
  onTab: (tab: Tab) => void;
  watchFocus: string;
  onWatchFocus: (id: string) => void;
  onPlay: (episode: Episode) => void;
  onMap: (episode: Episode) => void;
  onCameo: (mediaId: string) => void;
}

// The page sits behind a left nav rail. Only the active section is mounted,
// so the pairing session and its timers exist only while Link is open.
export const Browse = ({
  tab,
  onTab,
  watchFocus,
  onWatchFocus,
  onPlay,
  onMap,
  onCameo,
}: Props) => (
  <View style={styles.root}>
    {tab === 'watch' && (
      <WatchSection
        initialFocus={watchFocus}
        onPlay={onPlay}
        onMap={onMap}
        onCameo={onCameo}
        onFocusItem={onWatchFocus}
        onOpenLink={() => onTab('link')}
      />
    )}
    {tab === 'shared' && (
      <SharedSection onOpenLink={() => onTab('link')} onPlay={onPlay} />
    )}
    {tab === 'link' && <LinkSection />}
    <NavRail active={tab} onSelect={onTab} />
  </View>
);

const styles = StyleSheet.create({
  root: {flex: 1},
});
