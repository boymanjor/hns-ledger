/*!
 * client.js - internal client for ledger-app-hns
 * Copyright (c) 2018, The Bcoin Developers (MIT License).
 * Copyright (c) 2018, Boyma Fahnbulleh (MIT License).
 * https://github.com/boymanjor/hsd-ledger
 */

'use strict';

const assert = require('bsert');
const bufio = require('bufio');
const { encoding } = bufio;
const { MTX, Network } = require('hsd');

const util = require('../utils/util');
const { APDUCommand, APDUResponse } = require('../apdu');
const { Device } = require('../device/device');

/**
 * Ledger client interface for ledger-app-hns methods.
 * @see https://github.com/boymanjor/ledger-app-hns
 */

class LedgerClient {
  /**
   * Create ledger app.
   * @constructor
   * @param {Device} device
   */

  constructor(options) {
    assert(options.device instanceof Device);
    assert(options.network instanceof Network);
    this.device = options.device;
    this.network = options.network;
  }

  /**
   * Get app version.
   * @async
   * @returns {Object} data
   * @returns {String} data.version
   * @throws {LedgerError}
   */

  async getAppVersion() {
    assert(this.device);

    const cmd = APDUCommand.getAppVersion();
    const buf = await this.device.exchange(cmd.toRaw());
    const res = APDUResponse.getAppVersion(buf);

    return res.data;
  }

  /**
   * Get public key from specified path.
   *
   * @async
   * @param {(Number[]|String)} path - full derivation path
   * @param {Object} options
   * @param {Number} options.confirm - true for on-device confirmation
   * @param {Boolean} options.xpub - true to return xpub details
   * @param {Boolean} options.address - true to return address
   * @returns {Object} data
   * @returns {Buffer} data.publicKey
   * @returns {Buffer|undefined} data.chainCode
   * @returns {Number|undefined} data.parentFingerPrint
   * @returns {String|undefined} data.address
   * @throws {LedgerError}
   */

  async getPublicKey(path, options) {
    assert(this.device);

    if (typeof path === 'string')
      path = util.parsePath(path, true);

    assert(Array.isArray(path), 'path must be a String or Array');

    if (!options)
      options = Object.create(null);

    options.network = this.network.type;

    const cmd = APDUCommand.getPublicKey(path, options);
    const buf = await this.device.exchange(cmd.toRaw());
    const res = APDUResponse.getPublicKey(buf);

    return res.data;
  }

  /**
   * Send the transaction details to the Ledger device to begin
   * signature hash.
   * @async
   * @param {hsd.MTX} mtx - mutable transaction
   * @param {Map} ledgerInputByKey - Ledger aware inputs by outpoint keys
   * @throws {LedgerError}
   */

  async parseTX(mtx, ledgerInputByKey) {
    assert(this.device);
    assert(MTX.isMTX(mtx), 'mtx must be instanceof MTX');
    assert(ledgerInputByKey instanceof Map,
      'ledgerInputByKey must be instanceof Map');

    let size = 0;

    size += 8; // version + locktime
    size += encoding.sizeVarint(mtx.inputs.length);
    size += encoding.sizeVarint(mtx.outputs.length);

    for (const input of mtx.inputs) {
      size += 4;  // sequence
      size += input.prevout.getSize();
    }

    let outs = 0;

    for (const output of mtx.outputs) {
      outs += 8;  // value
      outs += output.address.getSize();
      outs += output.covenant.getVarSize();
    }

    size += encoding.sizeVarint(outs);
    size += outs;

    const buf = bufio.write(size);

    buf.writeU32(mtx.version);
    buf.writeU32(mtx.locktime);
    buf.writeVarint(mtx.inputs.length);
    buf.writeVarint(mtx.outputs.length);
    buf.writeVarint(outs);

    for (const input of mtx.inputs) {
      input.prevout.write(buf);
      buf.writeU32(input.sequence);
    }

    for (const output of mtx.outputs) {
      buf.writeU64(output.value);
      output.address.write(buf);
      output.covenant.write(buf);
    }

    const msgs = util.splitBuffer(buf.render(), util.MAX_TX_PACKET);
    const fst = msgs.shift();
    const packet = APDUCommand.parseTX(fst, true);
    const res = await this.device.exchange(packet.toRaw());

    APDUResponse.parseTX(res);

    for (const msg of msgs) {
      const packet = APDUCommand.parseTX(msg, false);
      const res = await this.device.exchange(packet.toRaw());
      APDUResponse.parseTX(res);
    }
  }

  /**
   * Send a signature request to the Ledger device for the specified input.
   * @async
   * @param {LedgerInput} ledgerInput - Ledger aware input
   * @param {hsd.Input} input - hsd input primitive
   * @returns {Object} data
   * @returns {Buffer} data.signature
   * @throws {LedgerError}
   */

  async getInputSignature(ledgerInput, hsdInput) {
    assert(this.device);

    // Add the var size to the beginning of the redeem script.
    const raw = ledgerInput.getPrevRedeem();
    const bw = bufio.write(raw.getVarSize());
    raw.write(bw);
    const script = bw.render();

    // Split the input script into packets.
    const msgs = util.splitBuffer(script, util.MAX_SCRIPT_PACKET, true);
    const first = msgs.shift();

    // Send the first packet.
    let packet = APDUCommand.getInputSignature(
      ledgerInput,
      hsdInput,
      first,
      true
    );

    let res = await this.device.exchange(packet.toRaw());

    // If there is only one packet to send, expect the signature.
    if (msgs.length === 0) {
      const { data } = APDUResponse.getInputSignature(res);
      return data;
    }

    // Otherwise, expect nothing.
    APDUResponse.getInputSignature(res, true);

    const last = msgs.pop();

    // Send intermediate packets, expecting nothing to be returned.
    // This loop is skipped if there are only two packets to send,
    // i.e. first and last.
    for (const msg of msgs) {
      const packet = APDUCommand.getInputSignature(null, null, msg, false);
      const res = await this.device.exchange(packet.toRaw());
      APDUResponse.getInputSignature(res, true);
    }

    // Send the last packet, expecting a signature to be returned.
    packet = APDUCommand.getInputSignature(null, null, last, false);
    res = await this.device.exchange(packet.toRaw());

    const { data } = APDUResponse.getInputSignature(res);
    return data;
  }
}

module.exports = LedgerClient;
