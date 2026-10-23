import React, {useCallback, useEffect, useRef, useState} from 'react';
import {BackHandler, StyleSheet, View} from 'react-native';
import {Tab} from './components/NavRail';
import {Episode} from './data/episodes';
import {Browse} from './screens/Browse';
import {PLAY_ID} from './screens/sections/WatchSection';
import {Intro} from './screens/Intro';
import {Player} from './screens/Player';
import {CameoRoute} from './map/CameoRoute';
import {colors} from './theme';

type Route =
  | {name: 'intro'}
  | {name: 'browse'}
  | {name: 'player'; episode: Episode; map?: boolean}
  | {name: 'map'; mediaId: string};

// Module scope survives the surface being destroyed on background (the JS
// runtime keeps running), so a warm return skips the intro and restores where
// the viewer was. A cold start reloads the module.
let introPlayed = false;
let lastRoute: Route | null = null;
let lastTab: Tab = 'watch';
let lastWatchFocus = PLAY_ID;

// Three routes do not justify a navigation library: a small route state and
// one BACK chain keep memory and focus behaviour predictable.
export const App = () => {
  const [route, setRouteState] = useState<Route>(
    introPlayed ? lastRoute ?? {name: 'browse'} : {name: 'intro'},
  );
  const [tab, setTabState] = useState<Tab>(lastTab);
  const screenBack = useRef<(() => boolean) | null>(null);

  const setRoute = useCallback((r: Route) => {
    lastRoute = r;
    setRouteState(r);
  }, []);
  const setTab = useCallback((t: Tab) => {
    lastTab = t;
    setTabState(t);
  }, []);
  const toBrowse = useCallback(() => {
    introPlayed = true;
    setRoute({name: 'browse'});
  }, [setRoute]);

  const registerBack = useCallback((h: (() => boolean) | null) => {
    screenBack.current = h;
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screenBack.current?.()) {
        return true; // a modal or panel inside the screen consumed it
      }
      switch (route.name) {
        case 'intro':
          toBrowse();
          return true;
        case 'player':
        case 'map':
          toBrowse();
          return true;
        case 'browse':
          if (tab !== 'watch') {
            setTab('watch');
            return true;
          }
          return false; // root: let the system exit the app
      }
    });
    return () => sub.remove();
  }, [route.name, tab, toBrowse, setTab]);

  return (
    <View style={styles.root}>
      {route.name === 'intro' && <Intro onDone={toBrowse} />}
      {route.name === 'browse' && (
        <Browse
          tab={tab}
          onTab={setTab}
          watchFocus={lastWatchFocus}
          onWatchFocus={(id) => (lastWatchFocus = id)}
          onPlay={(episode) => setRoute({name: 'player', episode})}
          onMap={(episode) => setRoute({name: 'player', episode, map: true})}
          onCameo={(mediaId) => setRoute({name: 'map', mediaId})}
        />
      )}
      {route.name === 'player' && (
        <Player
          episode={route.episode}
          startWithMap={route.map}
          onExit={toBrowse}
          registerBack={registerBack}
        />
      )}
      {route.name === 'map' && (
        <CameoRoute
          mediaId={route.mediaId}
          onClose={toBrowse}
          registerBack={registerBack}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.black},
});
