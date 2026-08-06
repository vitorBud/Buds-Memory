import assert from 'node:assert/strict'
import test from 'node:test'
import { stripInternalReasoning } from '../src/utils/respostaVisivel.ts'

test('remove raciocínio think e mantém somente a resposta final', () => {
  assert.equal(
    stripInternalReasoning('<think>segredo interno</think>Resposta final.'),
    'Resposta final.',
  )
})

test('remove aliases de raciocínio interno', () => {
  assert.equal(
    stripInternalReasoning('<analysis>análise</analysis><reasoning>plano</reasoning>Conclusão.'),
    'Conclusão.',
  )
})

test('stream não mostra tag think fragmentada', () => {
  for (const partial of ['<', '<t', '<thi', '<think']) {
    assert.equal(stripInternalReasoning(partial, true), '')
  }
  assert.equal(stripInternalReasoning('Olá <thi', true), 'Olá ')
})

test('stream descarta think não fechado até chegar a resposta visível', () => {
  assert.equal(stripInternalReasoning('<think>calculando', true), '')
  assert.equal(
    stripInternalReasoning('<think>calculando</think>Resposta'),
    'Resposta',
  )
})

test('preserva tags e código que não são raciocínio interno', () => {
  const code = '```html\n<section>Olá</section>\n```'
  assert.equal(stripInternalReasoning(code), code)
})
