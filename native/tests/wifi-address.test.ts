import assert from 'node:assert/strict';
import test from 'node:test';
import { wifiAddress } from '../src/adb';

const wifi = '192.168.80.0/24 dev wlan0 proto kernel scope link src 192.168.80.23';
const carrier = '10.12.0.0/30 dev rmnet_data1 proto kernel scope link src 10.12.0.2';

test('the Wi-Fi address wins over a carrier route listed first', () => {
  assert.equal(wifiAddress(wifi), '192.168.80.23');
  assert.equal(wifiAddress(carrier + '\n' + wifi), '192.168.80.23');
  assert.equal(wifiAddress(wifi + '\r\n' + carrier), '192.168.80.23');
});

test('without a wlan route the first address is used, and none means no Wi-Fi', () => {
  assert.equal(
    wifiAddress('192.168.1.0/24 dev eth0 proto kernel scope link src 192.168.1.9'),
    '192.168.1.9',
  );
  assert.equal(wifiAddress(''), undefined);
  assert.equal(wifiAddress('default via 192.168.80.1 dev wlan0'), undefined);
});
