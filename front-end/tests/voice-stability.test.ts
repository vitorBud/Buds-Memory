import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AsyncOperationGate,
  AdaptiveBargeInGate,
  RecordingChunkBuffer,
  TranscriptSilenceGate,
  VoiceEndpointDetector,
  VoiceTurnTelemetry,
  extractSpeakableChunks,
} from '../src/utils/controleOperacoes.ts'

test('pico de ruído não inicia nem encerra uma fala', () => {
  const detector = new VoiceEndpointDetector({ speechThreshold: 0.08, silenceMs: 1_400 })
  detector.observeVolume(0.1, 0)
  detector.observeVolume(0.01, 80)
  assert.equal(detector.hasConfirmedSpeech, false)
  assert.equal(detector.state, 'waiting')
})

test('pausa natural curta não encerra a frase', () => {
  const detector = new VoiceEndpointDetector({ speechThreshold: 0.08, silenceMs: 1_400 })
  detector.observeTranscript('Hoje eu fui trabalhar', 0)
  detector.observeVolume(0.01, 800)
  assert.equal(detector.tick(1_250), false)
  detector.observeTranscript('Hoje eu fui trabalhar, depois voltei para casa', 1_300)
  detector.observeVolume(0.01, 1_600)
  assert.equal(detector.tick(2_800), true)
  assert.equal(detector.state, 'complete')
})

test('iPhone encerra pela última mudança da transcrição mesmo com ruído contínuo', () => {
  const gate = new TranscriptSilenceGate()
  assert.equal(gate.observe('Olá', 500), true)
  assert.equal(gate.shouldFinalize(1_200, 1_100), false)
  assert.equal(gate.observe('Olá tudo bem', 1_250), true)
  assert.equal(gate.observe('Olá tudo bem', 1_900), false)
  assert.equal(gate.shouldFinalize(2_300, 1_100), false)
  assert.equal(gate.shouldFinalize(2_350, 1_100), true)
})

test('resultado de gravação antiga não fica ativo após nova operação', () => {
  const gate = new AsyncOperationGate()
  const first = gate.begin('recording')
  const second = gate.begin('recording')
  assert.equal(gate.isActive(first), false)
  assert.equal(gate.isActive(second), true)
  gate.complete(first)
  assert.equal(gate.isActive(second), true)
})

test('vinte ciclos consecutivos deixam apenas a operação atual válida', () => {
  const gate = new AsyncOperationGate()
  let previous = ''
  for (let index = 0; index < 20; index += 1) {
    const current = gate.begin('voice')
    if (previous) assert.equal(gate.isActive(previous), false)
    assert.equal(gate.isActive(current), true)
    previous = current
  }
  gate.complete(previous)
  assert.equal(gate.current, null)
})

test('buffer preserva começo, meio e fim de uma frase longa', async () => {
  const recordingId = 'recording-long'
  const buffer = new RecordingChunkBuffer(recordingId)
  buffer.append(recordingId, new Blob(['Hoje eu fui trabalhar, ']))
  buffer.append(recordingId, new Blob(['depois voltei para casa ']))
  buffer.append(recordingId, new Blob(['e quero continuar desenvolvendo o Buds.']))
  const result = buffer.finalize(recordingId, 'audio/test')
  assert.equal(await result?.text(), 'Hoje eu fui trabalhar, depois voltei para casa e quero continuar desenvolvendo o Buds.')
})

test('buffers de gravações consecutivas não se misturam', async () => {
  const first = new RecordingChunkBuffer('first')
  const second = new RecordingChunkBuffer('second')
  assert.equal(first.append('second', new Blob(['inválido'])), false)
  first.append('first', new Blob(['frase curta']))
  second.append('second', new Blob(['nova gravação']))
  assert.equal(await first.finalize('first', 'audio/test')?.text(), 'frase curta')
  assert.equal(await second.finalize('second', 'audio/test')?.text(), 'nova gravação')
})

test('chunker entrega uma frase antes do fim da resposta', () => {
  const result = extractSpeakableChunks('Primeira ideia pronta. A segunda ainda está sendo gerada')
  assert.deepEqual(result.chunks, ['Primeira ideia pronta.'])
  assert.equal(result.rest, 'A segunda ainda está sendo gerada')
})

test('chunker limita parágrafo longo mesmo sem ponto final', () => {
  const text = `${'explicação natural '.repeat(10)}, ${'continuação '.repeat(8)}`
  const result = extractSpeakableChunks(text, 120, 60)
  assert.ok(result.chunks.length >= 1)
  assert.ok(result.chunks[0].length <= 121)
  assert.ok(result.rest.length < text.length)
})

test('barge-in ignora eco curto abaixo do limiar conservador', () => {
  const detector = new VoiceEndpointDetector({
    speechThreshold: 0.22,
    activationMs: 720,
    minimumSpeechMs: 650,
    silenceMs: 1_400,
  })
  for (let now = 0; now <= 1_500; now += 100) detector.observeVolume(0.2, now)
  assert.equal(detector.hasConfirmedSpeech, false)
  assert.equal(detector.state, 'waiting')
})

test('barge-in confirma voz sustentada e encerra após silêncio', () => {
  const detector = new VoiceEndpointDetector({
    speechThreshold: 0.22,
    activationMs: 720,
    minimumSpeechMs: 650,
    silenceMs: 1_000,
  })
  detector.observeVolume(0.32, 0)
  detector.observeVolume(0.32, 750)
  detector.observeVolume(0.32, 900)
  assert.equal(detector.hasConfirmedSpeech, true)
  detector.observeVolume(0.01, 1_000)
  assert.equal(detector.tick(1_850), false)
  assert.equal(detector.tick(1_950), true)
})

test('barge-in adaptativo aprende ruído paralelo e aceita somente voz destacada', () => {
  const gate = new AdaptiveBargeInGate()
  for (let index = 0; index < 50; index += 1) gate.calibrate(0.17 + (index % 3) * 0.01)
  assert.ok(gate.threshold > 0.28)
  assert.equal(gate.accepts(0.24), false)
  assert.equal(gate.accepts(0.42), true)
})

test('telemetria calcula STT, TTFT, primeiro áudio e turno', () => {
  const telemetry = new VoiceTurnTelemetry('test', {
    recordingId: 'turn-1',
    mode: 'turn',
    captureStartedAt: 0,
    speechStartedAt: 100,
    speechEndedAt: 1_000,
    sttFirstPartialAt: 700,
    sttFinalAt: 1_250,
  })
  telemetry.mark('llm_start', 1_300)
  telemetry.mark('llm_first_token', 1_520)
  telemetry.mark('tts_first_chunk', 1_600)
  const snapshot = telemetry.mark('audio_start', 1_850)
  telemetry.mark('response_end', 3_000)
  assert.equal(snapshot.speech_to_text_latency_ms, 250)
  assert.equal(snapshot.ttft_ms, 220)
  assert.equal(snapshot.time_to_first_audio_ms, 850)
  assert.equal(snapshot.llm_to_first_audio_ms, 550)
  assert.equal(telemetry.snapshot().total_turn_time_ms, 2_900)
})
