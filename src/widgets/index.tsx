import React from 'react';
import {Widget} from '../analysis/schema';
import {WidgetContext} from './parts';
import {TechniqueCard} from './TechniqueCard';
import {
  ClaimCard,
  DossierCard,
  EntityListCard,
  ProtocolCard,
  RelationGraphCard,
  TimelineCard,
} from './Widgets';

export type {WidgetContext} from './parts';

export const WidgetView = ({w, ctx}: {w: Widget; ctx: WidgetContext}) => {
  switch (w.type) {
    case 'dossier':
      return <DossierCard w={w} ctx={ctx} />;
    case 'timeline':
      return <TimelineCard w={w} ctx={ctx} />;
    case 'relation_graph':
      return <RelationGraphCard w={w} />;
    case 'entity_list':
      return <EntityListCard w={w} />;
    case 'protocol':
      return <ProtocolCard w={w} />;
    case 'technique':
      return <TechniqueCard w={w} />;
    case 'claim':
      return <ClaimCard w={w} />;
  }
};
