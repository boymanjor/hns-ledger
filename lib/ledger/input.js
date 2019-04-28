/*!
 * input.js - Ledger transaction input.
 * Copyright (c) 2018, The Bcoin Developers (MIT License).
 * Copyright (c) 2018, Boyma Fahnbulleh (MIT License).
 * https://github.com/handshake-org/hsd
 */

'use strict';

const assert = require('bsert');
const Network = require('hsd/lib/protocol/network');
const Outpoint = require('hsd/lib/primitives/outpoint');
const Coin = require('hsd/lib/primitives/coin');
const KeyRing = require('hsd/lib/primitives/keyring');
const Script = require('hsd/lib/script').Script;

const LedgerError = require('../ledger/error');
const util = require('../utils/util');

/**
 * Transactions and outputs
 * to be used for next transaction
 */

class LedgerInput {
  /**
   * @constructor
   * @param {Object} options
   * @param {String|Number[]} options.path
   * @param {hsd.Coin} options.coin
   * @param {(hsd.Script|Buffer)?} options.redeem - script for P2SH.
   * @param {Buffer?} options.publicKey - raw public key for ring
   * @param {hsd.SighashType} [options.type=SIGHASH_ALL]
   */

  constructor(options) {
    this.path = [];
    this.coin = null;
    this.redeem = null;
    this.publicKey = null;
    this.type = Script.hashType.ALL;

    this._ring = null;
    this._key = '';
    this._prev = null;
    this._prevred = null;

    if (options)
      this.fromOptions(options);
  }

  /**
   * Set options for SignInput
   * @param {Object} options
   */

  fromOptions(options) {
    assert(options, 'SignInput data is required.');
    assert(options.path, 'Path is required.');

    if (typeof options.path === 'string')
      options.path = util.parsePath(options.path, true);

    assert(Array.isArray(options.path), 'Path must be Array or string');
    this.path = options.path;

    if (options.type != null) {
      assert(options.type !== Script.hashType.ALL,
        'Ledger only supports SIGHASH_ALL'
      );

      this.type = options.type;
    }

    if (options.redeem != null) {
      if (Buffer.isBuffer(options.redeem))
        options.redeem = Script.fromRaw(options.redeem);

      assert(Script.isScript(options.redeem), 'Cannot use non-script redeem.');
      this.redeem = options.redeem;
    }

    if (this.coin == null) {
      assert(Coin.isCoin(options.coin), 'LedgerInput needs Coin');
      this.coin = options.coin;
    }

    if (options.publicKey != null) {
      assert(Buffer.isBuffer(options.publicKey), 'Public key must be Buffer');
      this.publicKey = options.publicKey;
    }

    if (this.coin.address.isScripthash())
      assert(this.redeem, 'Cannot sign ScriptHash without redeem.');

    return this;
  }

  /**
   * Create SignInput from options
   * @see {@link LedgerInput}
   * @returns {LedgerInput}
   */

  static fromOptions(options) {
    return new this().fromOptions(options);
  }

  /**
   * Get Key from prevout
   * @returns {String}
   */

  toKey() {
    if (!this._key)
      this._key = this.getOutpoint().toKey();

    return this._key;
  }

  /**
   * Get prevout
   * @returns {hsd.Outpoint}
   */

  getOutpoint() {
    if (!this._outpoint)
      this._outpoint = Outpoint.fromOptions({
        hash: this.coin.hash,
        index: this.coin.index
      });

    return this._outpoint;
  }

  /**
   * Get previous script
   * @returns {hsd.Script}
   */

  getPrev() {
    if (!this._prev) {
      if (this.script) {
        this._prev = this.script;
      } else {
        this._prev = Script.fromPubkeyhash(this.getRing().getKeyHash());
      }
    }

    return this._prev;
  }

  /**
   * Get pubkey script or redeem script
   * also resolve Witness
   * @returns {Boolean}
   */

  getPrevRedeem() {
    if (this._prevred)
      return this._prevred;

    if (this.coin.address.isScripthash()) {
      this._prevred = this.redeem;
    } else {
      this._prevred = this.getPrev();
    }

    return this._prevred;
  }

  /**
   * Generate and return coin
   * @returns {hsd.Coin} coin
   */

  getCoin() {
    return this.coin;
  }

  /**
   * Get ring
   * @param {hsd.Network} [network=main]
   * @returns {hsd.KeyRing}
   */

  getRing(network = Network.primary) {
    if (!this.publicKey)
      throw new LedgerError('Cannot return ring without public key');

    if (!this._ring) {
      this._ring = KeyRing.fromPublic(this.publicKey, network);

      if (this.redeem)
        this._ring.script = this.redeem;
    }

    return this._ring;
  }

  /**
   * Clear the cache
   */

  refresh() {
    this._coin = null;
    this._ring = null;
    this._key = '';
    this._prev = null;
    this._outpoint = null;
  }
}

/*
 * Helpers
 */

module.exports = LedgerInput;
