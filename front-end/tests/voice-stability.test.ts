import assert from 'node:assert/strict'
import test from 'node:test'
import { AsyncOperationGate, RecordingChunkBuffer, VoiceEndpointDetector } from '../src/utils/controleOperacoes.ts'

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
