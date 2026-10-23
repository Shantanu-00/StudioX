import {ANALYSES} from '../../src/analysis/fixtures';
import {isShareable, toPhoneCard} from '../../src/services/phoneCards';

describe('phone cards', () => {
  const widgets = ANALYSES['science-ep42'].widgets;
  const byId = (id: string) => widgets.find((w) => w.id === id)!;

  it('turns a protocol into a checklist and an entity list into a list', () => {
    expect(toPhoneCard(byId('evening'))).toMatchObject({
      type: 'checklist',
      title: 'Evening routine, as described',
      items: expect.arrayContaining([
        {text: 'Cool the room · Bedroom kept at 18 °C'},
      ]),
    });
    expect(toPhoneCard(byId('compounds'))).toMatchObject({
      type: 'list',
      items: expect.arrayContaining([
        expect.objectContaining({name: 'Apigenin · 50 mg'}),
      ]),
    });
  });

  it('shares nothing else', () => {
    expect(isShareable(byId('siesta-claim'))).toBe(false);
    expect(toPhoneCard(byId('siesta-claim'))).toBeNull();
  });
});
