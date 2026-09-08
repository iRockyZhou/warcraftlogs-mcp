import { describe, expect, it } from 'vitest';
import { WclError } from '../src/errors.js';
import { parseWclUrl, resolveReportReference } from '../src/url.js';

const CODE = 'gDBTZr6pz1AvnxbW';

describe('parseWclUrl', () => {
  it('parses global and CN report URLs', () => {
    expect(parseWclUrl(`https://www.warcraftlogs.com/reports/${CODE}?fight=1`)).toMatchObject({
      region: 'global',
      reportCode: CODE,
      fight: 1,
    });
    expect(parseWclUrl(`https://cn.warcraftlogs.com/reports/${CODE}?fight=last`)).toMatchObject({
      region: 'cn',
      reportCode: CODE,
      fight: 'last',
    });
  });

  it('parses hash fight selectors', () => {
    expect(
      parseWclUrl(`https://cn.warcraftlogs.com/reports/${CODE}#fight=7&type=damage-done`).fight,
    ).toBe(7);
    expect(
      parseWclUrl(`https://cn.warcraftlogs.com/reports/${CODE}#/view?type=damage&fight=last`).fight,
    ).toBe('last');
  });

  it.each([
    `https://www.warcraftlogs.com.evil.example/reports/${CODE}?fight=1`,
    `https://www.warcraftlogs.com@evil.example/reports/${CODE}?fight=1`,
    `http://www.warcraftlogs.com/reports/${CODE}?fight=1`,
    `https://www.warcraftlogs.com:444/reports/${CODE}?fight=1`,
    `https://www.warcraftlogs.com/reports/${CODE}/extra?fight=1`,
  ])('rejects unsafe URL %s', (url) => {
    expect(() => parseWclUrl(url)).toThrow(WclError);
  });

  it('accepts a bare report code with an explicit region', () => {
    expect(resolveReportReference(CODE, 'cn')).toMatchObject({
      origin: 'https://cn.warcraftlogs.com',
      reportCode: CODE,
      inputWasUrl: false,
    });
  });
});
