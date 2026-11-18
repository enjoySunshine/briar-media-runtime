import QUnit from 'qunit';
import {
  MediaSequenceSync,
  DependantMediaSequenceSync
} from '../../src/util/media-sequence-sync';

QUnit.module('MediaSequenceSync: update', function(hooks) {
  let mediaSequenceSync;

  hooks.beforeEach(function() {
    mediaSequenceSync = new MediaSequenceSync();
  });

  QUnit.test('update calculates correct base time based on mediaSequence of new playlist', function(assert) {
    const initialMediaSequence = 10;
    const initialSegments = [
      // Segment 10 with duration 5
      { duration: 5 },
      // Segment 11 with duration 6
      { duration: 6 },
      // Segment 12 with duration 7
      { duration: 7 }
    ];

    // Initial update with starting playlist
    mediaSequenceSync.update(
      {
        mediaSequence: initialMediaSequence,
        segments: initialSegments
      },
      // Current time, value is used for fallback and not significant here
      20
    );

    // Confirm that the initial update set the correct start and end times
    assert.strictEqual(
      mediaSequenceSync.start,
      0,
      'The start time is set to the initial value of 0.'
    );

    // Confirm the end time is the correct sum of the segment durations
    // = 18
    const expectedInitialEndTime = 0 + 5 + 6 + 7;

    assert.strictEqual(
      mediaSequenceSync.end,
      expectedInitialEndTime,
      'The end time is calculated correctly after the initial update.'
    );

    // New playlist with higher mediaSequence
    let newMediaSequence = 11;
    let newSegments = [
      // Segment 11 with duration 4
      { duration: 4 },
      // Segment 12 with duration 5
      { duration: 5 },
      // Segment 13 with duration 6
      { duration: 6 }
    ];

    // Update with the new playlist
    mediaSequenceSync.update(
      {
        mediaSequence: newMediaSequence,
        segments: newSegments
      },
      30
    );

    // Segment 10 with duration 5 has fallen off the start of the playlist
    let expectedStartTime = 5;

    assert.strictEqual(
      mediaSequenceSync.start,
      expectedStartTime,
      'The base time is calculated correctly when a new playlist with a higher mediaSequence is loaded.'
    );

    // New playlist with lower mediaSequence
    newMediaSequence = 10;
    newSegments = [
      // Segment 10 with duration 5
      { duration: 5 },
      // Segment 11 with duration 6
      { duration: 6 },
      // Segment 12 with duration 7
      { duration: 7 }
    ];

    // Update with the new playlist
    mediaSequenceSync.update(
      {
        mediaSequence: newMediaSequence,
        segments: newSegments
      },
      40
    );

    // Expected base time is calculated by extrapolating backwards:
    // Segment 11 start time: 5
    // Segment 10 start time: Segment 11 start time (5) - Segment 10 duration (5) = 0
    expectedStartTime = 0;

    assert.strictEqual(
      mediaSequenceSync.start,
      expectedStartTime,
      'The base time is calculated correctly when a new playlist with a lower mediaSequence is loaded.'
    );
  });
});

QUnit.module('DependantMediaSequenceSync', function(hooks) {
  let main;
  let audio;
  let vtt;

  hooks.beforeEach(function() {
    main = new MediaSequenceSync();
    audio = new DependantMediaSequenceSync(main);
    vtt = new DependantMediaSequenceSync(main);
  });

  const openingPlaylist = {
    // media sequence 10, durations 5, 6, 7
    mediaSequence: 10,
    segments: [
      { duration: 5 },
      { duration: 6 },
      { duration: 7 }
    ]
  };

  const slidPlaylist = {
    // first segment expired, media sequence 11, durations 4, 5, 6
    mediaSequence: 11,
    segments: [
      { duration: 4 },
      { duration: 5 },
      { duration: 6 }
    ]
  };

  QUnit.test('main, audio and vtt share the opening live window 0 -> 18', function(assert) {
    main.update(openingPlaylist, 20);
    audio.update(openingPlaylist, 20);
    vtt.update(openingPlaylist, 20);

    assert.strictEqual(main.start, 0, 'main window start is 0');
    assert.strictEqual(main.end, 18, 'main window end is 18');
    assert.strictEqual(audio.start, 0, 'audio window start follows main at 0');
    assert.strictEqual(audio.end, 18, 'audio window end follows main at 18');
    assert.strictEqual(vtt.start, 0, 'vtt window start follows main at 0');
    assert.strictEqual(vtt.end, 18, 'vtt window end follows main at 18');
  });

  QUnit.test('playback time maps to the same segment on all three loaders', function(assert) {
    main.update(openingPlaylist, 20);
    audio.update(openingPlaylist, 20);
    vtt.update(openingPlaylist, 20);

    // playback time 7 lands in media sequence 11, which spans 5 -> 11
    const mainSyncInfo = main.getSyncInfoForTime(7);
    const audioSyncInfo = audio.getSyncInfoForTime(7);
    const vttSyncInfo = vtt.getSyncInfoForTime(7);

    assert.strictEqual(mainSyncInfo.segmentIndex, 1, 'main time 7 selects segment index 1');
    assert.strictEqual(mainSyncInfo.start, 5, 'main segment starts at 5');
    assert.strictEqual(mainSyncInfo.end, 11, 'main segment ends at 11');
    assert.strictEqual(audioSyncInfo.segmentIndex, 1, 'audio time 7 selects segment index 1');
    assert.strictEqual(audioSyncInfo.start, 5, 'audio segment starts at 5');
    assert.strictEqual(vttSyncInfo.segmentIndex, 1, 'vtt time 7 selects segment index 1');
    assert.strictEqual(vttSyncInfo.start, 5, 'vtt segment starts at 5');
  });

  QUnit.test('audio and vtt window start moves with main when the window slides', function(assert) {
    main.update(openingPlaylist, 20);
    audio.update(openingPlaylist, 20);
    vtt.update(openingPlaylist, 20);

    main.update(slidPlaylist, 30);
    audio.update(slidPlaylist, 30);
    vtt.update(slidPlaylist, 30);

    assert.strictEqual(main.start, 5, 'main window start slides to 5');
    assert.strictEqual(main.end, 20, 'main window end slides to 20');
    assert.strictEqual(audio.start, 5, 'audio window start stays with main at 5, not 0');
    assert.strictEqual(audio.end, 20, 'audio window end stays with main at 20');
    assert.strictEqual(vtt.start, 5, 'vtt window start stays with main at 5, not 0');
    assert.strictEqual(vtt.end, 20, 'vtt window end stays with main at 20');
  });

  QUnit.test('after the slide, playback time 6 lands in the first window segment 5 -> 9', function(assert) {
    main.update(openingPlaylist, 20);
    audio.update(openingPlaylist, 20);
    vtt.update(openingPlaylist, 20);
    main.update(slidPlaylist, 30);
    audio.update(slidPlaylist, 30);
    vtt.update(slidPlaylist, 30);

    const mainSyncInfo = main.getSyncInfoForTime(6);
    const audioSyncInfo = audio.getSyncInfoForTime(6);
    const vttSyncInfo = vtt.getSyncInfoForTime(6);

    assert.strictEqual(mainSyncInfo.segmentIndex, 0, 'main time 6 selects the first window segment');
    assert.strictEqual(mainSyncInfo.start, 5, 'main first segment starts at 5');
    assert.strictEqual(mainSyncInfo.end, 9, 'main first segment ends at 9');
    assert.strictEqual(audioSyncInfo.start, 5, 'audio first segment starts at 5');
    assert.strictEqual(audioSyncInfo.end, 9, 'audio first segment ends at 9');
    assert.strictEqual(vttSyncInfo.start, 5, 'vtt first segment starts at 5');
    assert.strictEqual(vttSyncInfo.end, 9, 'vtt first segment ends at 9');
  });

  QUnit.test('window start returns to 0 on all loaders when rolling back to the opening playlist', function(assert) {
    main.update(openingPlaylist, 20);
    audio.update(openingPlaylist, 20);
    vtt.update(openingPlaylist, 20);
    main.update(slidPlaylist, 30);
    audio.update(slidPlaylist, 30);
    vtt.update(slidPlaylist, 30);

    main.update(openingPlaylist, 40);
    audio.update(openingPlaylist, 40);
    vtt.update(openingPlaylist, 40);

    assert.strictEqual(main.start, 0, 'main window start returns to 0');
    assert.strictEqual(audio.start, 0, 'audio window start returns to 0');
    assert.strictEqual(vtt.start, 0, 'vtt window start returns to 0');
  });

  QUnit.test('dependant anchors to the main start of the same media sequence', function(assert) {
    // main establishes the opening window (start 0) then slides (start 5)
    main.update(openingPlaylist, 20);
    main.update(slidPlaylist, 30);

    // media sequence 12 starts at 9 on the main timeline (5 + the 4s first segment)
    const dependantPlaylist = {
      mediaSequence: 12,
      segments: [
        { duration: 5 },
        { duration: 6 },
        { duration: 7 }
      ]
    };

    audio.update(dependantPlaylist, 30);

    assert.strictEqual(audio.start, 9, 'audio uses the main start for media sequence 12');
    assert.strictEqual(audio.end, 27, 'audio window end is based on the anchored start');
  });

  QUnit.test('dependant holds the main window start when main lacks the media sequence', function(assert) {
    // main establishes the opening window (start 0) then slides (start 5)
    main.update(openingPlaylist, 20);
    main.update(slidPlaylist, 30);

    const dependantPlaylist = {
      // main only knows media sequences 11-13
      mediaSequence: 14,
      segments: [
        { duration: 5 },
        { duration: 6 },
        { duration: 7 }
      ]
    };

    audio.update(dependantPlaylist, 30);

    assert.strictEqual(audio.start, 5, 'audio keeps the main window start of 5, not its own base time');
    assert.strictEqual(audio.end, 23, 'audio window end is based on the main anchored start');
  });

  QUnit.test('dependant keeps its own segment storage and appended state', function(assert) {
    const playlist = {
      mediaSequence: 0,
      segments: [
        { duration: 2 },
        { duration: 2 }
      ]
    };

    main.update(playlist, 0);
    audio.update(playlist, 0);

    audio.getSyncInfoForMediaSequence(0).segmentSyncInfo.markAppended();

    assert.strictEqual(
      audio.getSyncInfoForMediaSequence(0).segmentSyncInfo.isAppended,
      true,
      'audio segment is marked appended'
    );
    assert.strictEqual(
      main.getSyncInfoForMediaSequence(0).segmentSyncInfo.isAppended,
      false,
      'main appended state is not changed by the audio loader'
    );
  });
});
