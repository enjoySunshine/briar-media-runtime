import {compactSegmentUrlDescription} from './segment';

class SyncInfo {
  /**
   * @param {number} start - media sequence start
   * @param {number} end - media sequence end
   * @param {number} segmentIndex - index for associated segment
   * @param {number|null} [partIndex] - index for associated part
   * @param {boolean} [appended] - appended indicator
   *
   */
  constructor({start, end, segmentIndex, partIndex = null, appended = false}) {
    this.start_ = start;
    this.end_ = end;
    this.segmentIndex_ = segmentIndex;
    this.partIndex_ = partIndex;
    this.appended_ = appended;
  }

  isInRange(targetTime) {
    return targetTime >= this.start && targetTime < this.end;
  }

  markAppended() {
    this.appended_ = true;
  }

  resetAppendedStatus() {
    this.appended_ = false;
  }

  get isAppended() {
    return this.appended_;
  }

  get start() {
    return this.start_;
  }

  get end() {
    return this.end_;
  }

  get segmentIndex() {
    return this.segmentIndex_;
  }

  get partIndex() {
    return this.partIndex_;
  }
}

class SyncInfoData {
  /**
   *
   * @param {SyncInfo} segmentSyncInfo - sync info for a given segment
   * @param {Array<SyncInfo>} [partsSyncInfo] - sync infos for a list of parts for a given segment
   */
  constructor(segmentSyncInfo, partsSyncInfo = []) {
    this.segmentSyncInfo_ = segmentSyncInfo;
    this.partsSyncInfo_ = partsSyncInfo;
  }

  get segmentSyncInfo() {
    return this.segmentSyncInfo_;
  }

  get partsSyncInfo() {
    return this.partsSyncInfo_;
  }

  get hasPartsSyncInfo() {
    return this.partsSyncInfo_.length > 0;
  }

  resetAppendStatus() {
    this.segmentSyncInfo_.resetAppendedStatus();
    this.partsSyncInfo_.forEach((partSyncInfo) => partSyncInfo.resetAppendedStatus());
  }
}

export class MediaSequenceSync {
  constructor() {
    /**
     * @type {Map<number, SyncInfoData>}
     * @protected
     */
    this.storage_ = new Map();
    this.diagnostics_ = '';
    this.isReliable_ = false;
    this.start_ = -Infinity;
    this.end_ = Infinity;
  }

  get start() {
    return this.start_;
  }

  get end() {
    return this.end_;
  }

  get diagnostics() {
    return this.diagnostics_;
  }

  get isReliable() {
    return this.isReliable_;
  }

  resetAppendedStatus() {
    this.storage_.forEach((syncInfoData) => syncInfoData.resetAppendStatus());
  }

  /**
   * update sync storage
   *
   * @param {Object} playlist
   * @param {number} currentTime
   *
   * @return {void}
   */
  update(playlist, currentTime) {
    const { mediaSequence, segments } = playlist;

    this.isReliable_ = this.isReliablePlaylist_(mediaSequence, segments);

    if (!this.isReliable_) {
      return;
    }

    return this.updateStorage_(
      segments,
      mediaSequence,
      this.calculateBaseTime_(mediaSequence, segments, currentTime)
    );
  }

  /**
   * @param {number} targetTime
   * @return {SyncInfo|null}
   */
  getSyncInfoForTime(targetTime) {
    for (const { segmentSyncInfo, partsSyncInfo } of this.storage_.values()) {
      // Normal segment flow:
      if (!partsSyncInfo.length) {
        if (segmentSyncInfo.isInRange(targetTime)) {
          return segmentSyncInfo;
        }
      } else {
        // Low latency flow:
        for (const partSyncInfo of partsSyncInfo) {
          if (partSyncInfo.isInRange(targetTime)) {
            return partSyncInfo;
          }
        }
      }
    }

    return null;
  }

  getSyncInfoForMediaSequence(mediaSequence) {
    return this.storage_.get(mediaSequence);
  }

  updateStorage_(segments, startingMediaSequence, startingTime) {
    const newStorage = new Map();
    let newDiagnostics = '\n';

    let currentStart = startingTime;
    let currentMediaSequence = startingMediaSequence;

    this.start_ = currentStart;

    segments.forEach((segment, segmentIndex) => {
      const prevSyncInfoData = this.storage_.get(currentMediaSequence);

      const segmentStart = currentStart;
      const segmentEnd = segmentStart + segment.duration;
      const segmentIsAppended = Boolean(prevSyncInfoData &&
        prevSyncInfoData.segmentSyncInfo &&
        prevSyncInfoData.segmentSyncInfo.isAppended);

      const segmentSyncInfo = new SyncInfo({
        start: segmentStart,
        end: segmentEnd,
        appended: segmentIsAppended,
        segmentIndex
      });

      segment.syncInfo = segmentSyncInfo;

      let currentPartStart = currentStart;

      const partsSyncInfo = (segment.parts || []).map((part, partIndex) => {
        const partStart = currentPartStart;
        const partEnd = currentPartStart + part.duration;
        const partIsAppended = Boolean(prevSyncInfoData &&
          prevSyncInfoData.partsSyncInfo &&
          prevSyncInfoData.partsSyncInfo[partIndex] &&
          prevSyncInfoData.partsSyncInfo[partIndex].isAppended);

        const partSyncInfo = new SyncInfo({
          start: partStart,
          end: partEnd,
          appended: partIsAppended,
          segmentIndex,
          partIndex
        });

        currentPartStart = partEnd;
        newDiagnostics += `Media Sequence: ${currentMediaSequence}.${partIndex} | Range: ${partStart} --> ${partEnd} | Appended: ${partIsAppended}\n`;
        part.syncInfo = partSyncInfo;

        return partSyncInfo;
      });

      newStorage.set(currentMediaSequence, new SyncInfoData(segmentSyncInfo, partsSyncInfo));
      newDiagnostics += `${compactSegmentUrlDescription(segment.resolvedUri)} | Media Sequence: ${currentMediaSequence} | Range: ${segmentStart} --> ${segmentEnd} | Appended: ${segmentIsAppended}\n`;

      currentMediaSequence++;
      currentStart = segmentEnd;
    });

    this.end_ = currentStart;
    this.storage_ = newStorage;
    this.diagnostics_ = newDiagnostics;
  }

  calculateBaseTime_(mediaSequence, segments, fallback) {
    if (!this.storage_.size) {
      // Initial setup flow.
      return 0;
    }

    if (this.storage_.has(mediaSequence)) {
      // Normal flow.
      return this.storage_.get(mediaSequence).segmentSyncInfo.start;
    }

    const minMediaSequenceFromStorage = Math.min(...this.storage_.keys());

    // This case captures a race condition that can occur if we switch to a new media playlist that is out of date
    // and still has an older Media Sequence. If this occurs, we extrapolate backwards to get the base time.
    if (mediaSequence < minMediaSequenceFromStorage) {
      const mediaSequenceDiff = minMediaSequenceFromStorage - mediaSequence;
      let baseTime = this.storage_.get(minMediaSequenceFromStorage).segmentSyncInfo.start;

      for (let i = 0; i < mediaSequenceDiff; i++) {
        const segment = segments[i];

        baseTime -= segment.duration;
      }

      return baseTime;
    }

    // Fallback flow.
    // There is a gap between last recorded playlist and a new one received.
    return fallback;
  }

  isReliablePlaylist_(mediaSequence, segments) {
    return mediaSequence !== undefined && mediaSequence !== null && Array.isArray(segments) && segments.length;
  }
}

/**
 * Dependant media (alternate audio and subtitles) must always follow the main
 * media's placement on the timeline. A dependant sync keeps its own segment
 * level storage (segment references, part info and appended status all belong
 * to its own playlist), but it never defines its own place on the timeline:
 * the base time of every playlist update is anchored to the main sync.
 *
 * Without this, each loader derives the live window start independently, so
 * when the window slides (a segment expires from the playlist), the main
 * loader's window moves while the audio and VTT loaders can remain on the old
 * base time. Anchoring the base time to the main sync guarantees that all
 * three loaders see the same window start/end and map a playback time to the
 * same position within the window.
 */
export class DependantMediaSequenceSync extends MediaSequenceSync {
  constructor(parent) {
    super();

    this.parent_ = parent;
  }

  calculateBaseTime_(mediaSequence, segments, fallback) {
    // Prefer the main sync's start for the same media sequence. This is the
    // normal flow: main and dependant playlists refresh together and carry the
    // same media sequences.
    const parentInfo = this.parent_.getSyncInfoForMediaSequence(mediaSequence);

    if (parentInfo) {
      return parentInfo.segmentSyncInfo.start;
    }

    // The main sync has not recorded this media sequence (for example, the
    // dependant playlist refreshed first, or carries media sequences outside
    // the main playlist's current window). A dependant loader must never derive
    // its place on the timeline from its own storage or the current playback
    // time: doing so lets it drift from main when the window slides. Hold the
    // main window's start instead so all three loaders share one anchor.
    if (isFinite(this.parent_.start)) {
      return this.parent_.start;
    }

    // Main has not established a window yet, fall back to the base behavior
    // (which resolves to time 0 for the first playlist update).
    return super.calculateBaseTime_(mediaSequence, segments, fallback);
  }
}
