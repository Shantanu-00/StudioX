import 'react-native';
import {render} from '@testing-library/react-native';
import * as React from 'react';

import {validateWidget, Widget} from '../../src/analysis/schema';
import {WidgetView} from '../../src/widgets';
import {domainOf} from '../../src/widgets/parts';

const ctx = {
  now: 10,
  onSeek: jest.fn(),
  onLocked: jest.fn(),
  spoilersRevealed: false,
  firstFocus: false,
};

const claim = (extra: object) =>
  validateWidget({
    id: 'c',
    type: 'claim',
    claim: 'Midday sleep cuts strain by 37 percent.',
    speaker: 'Dr. Julian',
    context: 'Observational; counted deaths. A second sentence.',
    evidence: [{t0: 5, t1: 11}],
    ...extra,
  }) as Widget;

describe('claim detail', () => {
  it('draws who said it, a one-sentence why and up to three source lines', () => {
    const screen = render(
      <WidgetView
        ctx={ctx}
        w={claim({
          verdict: 'DEBUNKED',
          sources: [
            {
              title: 'Naska 2007',
              url: 'https://www.jamanetwork.com/x',
              date: '2007',
            },
            {title: 'B · b.org', url: 'https://b.org/1'},
            {title: 'c.org', url: 'https://c.org/1'},
            {title: 'D', url: 'https://d.org/1'},
          ],
        })}
      />,
    );
    expect(screen.getByText('Dr. Julian')).toBeTruthy();
    expect(screen.getByText('0:05')).toBeTruthy();
    expect(screen.getByText('Observational; counted deaths.')).toBeTruthy();
    expect(
      screen.getByText('Naska 2007 · jamanetwork.com · 2007'),
    ).toBeTruthy();
    // Titles that already carry the domain, or are only the domain, do not
    // repeat it.
    expect(screen.getByText('B · b.org')).toBeTruthy();
    expect(screen.getByText('c.org')).toBeTruthy();
    expect(screen.queryByText(/d\.org/)).toBeNull();
  });

  it('quotes the claim only under a curator headline', () => {
    const plain = render(<WidgetView ctx={ctx} w={claim({})} />);
    expect(plain.queryByText(/^“/)).toBeNull();
    const headed = render(
      <WidgetView ctx={ctx} w={claim({headline: 'Naps and the heart'})} />,
    );
    expect(
      headed.getByText('“Midday sleep cuts strain by 37 percent.”'),
    ).toBeTruthy();
  });

  it('reduces a URL to its domain', () => {
    expect(domainOf('https://WWW.Example.org:443/a?b')).toBe('example.org');
  });
});

describe('person detail', () => {
  const person = validateWidget({
    id: 'p',
    type: 'dossier',
    name: 'Marcus Vance',
    role: 'Suspect',
    evidence: [{t0: 0, t1: 37}],
    facts: [
      {text: 'Swore he never left the diner.', evidence: {t0: 2, t1: 8}},
      {text: 'Phone pinged at Pier 9.', evidence: {t0: 8, t1: 15}},
      {text: 'Burner phone cracked.', evidence: {t0: 15, t1: 20}},
      {text: 'Cameras were cut.', evidence: {t0: 20, t1: 30}},
    ],
  }) as Widget;

  it('shows initials without a portrait and only facts heard so far', () => {
    const screen = render(<WidgetView ctx={{...ctx, now: 9}} w={person} />);
    expect(screen.getByText('MV')).toBeTruthy();
    expect(screen.getByText('Swore he never left the diner.')).toBeTruthy();
    expect(screen.getByText('Phone pinged at Pier 9.')).toBeTruthy();
    expect(screen.queryByText('Cameras were cut.')).toBeNull();
  });
});
