import { registerPlugin } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import type {
  ChatStreamEvent,
  CognitiveMemory,
  ConversationStorageItem,
  FocusAnalyzePreview,
  FocusInboxItem,
  FocusTask,
  FocusTaskCategory,
  FocusTaskPriority,
  FocusTimelineEvent,
  Message,
  Session,
} from '../../types'
import { stripInternalReasoning } from '../../utils/respostaVisivel'

export interface IOSLocalStorageStatus {
  availableBytes: number
  usedBytes: number
  databaseBytes: number
  warning: boolean
  databaseBlocked: boolean
  modelDownloadAllowed: boolean
}

export interface IOSLocalStatus {
  databaseReady: boolean
  modelInstalled: boolean
  modelBytes: number
  modelExpectedBytes: number
  modelRequiredBytes: number
  modelName: string
  thermalState: 'nominal' | 'fair' | 'serious' | 'critical' | 'unknown'
  lowPowerMode: boolean
  storage: IOSLocalStorageStatus
}

interface IOSLocalPlugin {
  status(): Promise<IOSLocalStatus>
  downloadModel(): Promise<IOSLocalStatus>
  cancelModelDownload(): Promise<void>
  clearAllData(options: { confirmation: string }): Promise<IOSLocalStatus>
  listSessions(): Promise<{ sessions: Session[] }>
  createSession(options: { title?: string }): Promise<Session>
  updateSessionTitle(options: { id: string; title: string }): Promise<Session>
  deleteSession(options: { id: string }): Promise<void>
  listConversationStorage(): Promise<{ conversations: ConversationStorageItem[] }>
  purgeConversation(options: { id: string; confirmation: string }): Promise<{ conversations: ConversationStorageItem[] }>
  getMessages(options: { sessionId: string }): Promise<{ messages: Message[] }>
  getMemories(options: { limit: number }): Promise<{ memories: CognitiveMemory[] }>
  createMemory(options: { content: string; importance: number }): Promise<CognitiveMemory>
  updateMemory(options: { id: number; content?: string; importance?: number }): Promise<CognitiveMemory>
  setCoreMemory(options: { id: number; enabled: boolean }): Promise<CognitiveMemory>
  deleteMemory(options: { id: number; force: boolean }): Promise<void>
  listFocusTasks(): Promise<{ tasks: FocusTask[] }>
  createFocusTask(options: {
    title: string
    category: FocusTaskCategory
    priority: FocusTaskPriority
    isFocus: boolean
    dueDate?: string
    itemType?: FocusTask['item_type']
  }): Promise<FocusTask>
  updateFocusTask(options: {
    id: number
    title?: string
    category?: FocusTaskCategory
    priority?: FocusTaskPriority
    completed?: boolean
    isFocus?: boolean
  }): Promise<FocusTask>
  deleteFocusTask(options: { id: number }): Promise<void>
  analyzeFocusInput(options: { text: string }): Promise<FocusAnalyzePreview>
  focusThink(options: { query: string }): Promise<{ suggestion: string }>
  saveFocusIdea(options: { content: string }): Promise<void>
  saveFocusDecision(options: { content: string }): Promise<void>
  listFocusTimeline(): Promise<{ events: FocusTimelineEvent[] }>
  listFocusInbox(): Promise<{ items: FocusInboxItem[] }>
  updateFocusInbox(options: { id: number; status: 'approved' | 'ignored' }): Promise<void>
  syncFocusNotifications(): Promise<{ scheduled: number; authorized: boolean }>
  startSpeechRecognition(options: { recordingId: string }): Promise<void>
  stopSpeechRecognition(options: { recordingId: string }): Promise<{ text: string; recordingId: string }>
  cancelSpeechRecognition(options: { recordingId?: string }): Promise<void>
  generate(options: { sessionId: string; text: string; generationId: string }): Promise<{
    generationId: string
    text: string
    model: string
    session?: Session
    metrics?: Record<string, unknown>
  }>
  stopGeneration(options: { generationId?: string }): Promise<void>
  addListener(
    eventName: 'chatToken',
    listener: (event: { generationId: string; content: string; model: string }) => void,
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'modelDownloadProgress',
    listener: (event: { progress: number; downloadedBytes: number; totalBytes: number }) => void,
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'speechRecognitionUpdate',
    listener: (event: { text: string; isFinal: boolean; volume: number; recordingId: string }) => void,
  ): Promise<PluginListenerHandle>
}

const native = registerPlugin<IOSLocalPlugin>('BudsLocal')

export function getIOSLocalStatus() {
  return native.status()
}

export async function downloadIOSLocalModel(
  onProgress: (progress: number, downloadedBytes: number, totalBytes: number) => void,
): Promise<IOSLocalStatus> {
  const listener = await native.addListener('modelDownloadProgress', event => {
    onProgress(event.progress, event.downloadedBytes, event.totalBytes)
  })
  try {
    return await native.downloadModel()
  } finally {
    await listener.remove()
  }
}

export function cancelIOSLocalModelDownload() {
  return native.cancelModelDownload()
}

export function clearIOSLocalData(confirmation: string) {
  return native.clearAllData({ confirmation })
}

export async function listIOSLocalSessions(): Promise<Session[]> {
  return (await native.listSessions()).sessions
}

export function createIOSLocalSession(title?: string): Promise<Session> {
  return native.createSession(title ? { title } : {})
}

export function updateIOSLocalSessionTitle(id: string, title: string): Promise<Session> {
  return native.updateSessionTitle({ id, title })
}

export function deleteIOSLocalSession(id: string): Promise<void> {
  return native.deleteSession({ id })
}

export async function listIOSConversationStorage(): Promise<ConversationStorageItem[]> {
  return (await native.listConversationStorage()).conversations
}

export async function purgeIOSConversation(id: string): Promise<ConversationStorageItem[]> {
  return (await native.purgeConversation({ id, confirmation: `APAGAR:${id}` })).conversations
}

export async function getIOSLocalMessages(sessionId: string): Promise<Message[]> {
  return (await native.getMessages({ sessionId })).messages
    .map(message => message.sender === 'ia'
      ? { ...message, text: stripInternalReasoning(message.text).trim() }
      : message)
    .filter(message => message.sender === 'user' || Boolean(message.text))
}

export async function getIOSLocalMemories(limit: number): Promise<CognitiveMemory[]> {
  return (await native.getMemories({ limit })).memories
}

export function createIOSLocalMemory(content: string, importance = 0.75): Promise<CognitiveMemory> {
  return native.createMemory({ content, importance })
}

export function updateIOSLocalMemory(
  id: number,
  updates: { content?: string; importance?: number },
): Promise<CognitiveMemory> {
  return native.updateMemory({ id, ...updates })
}

export function setIOSLocalCoreMemory(id: number, enabled: boolean): Promise<CognitiveMemory> {
  return native.setCoreMemory({ id, enabled })
}

export function deleteIOSLocalMemory(id: number, force = false): Promise<void> {
  return native.deleteMemory({ id, force })
}

export async function listIOSFocusTasks(): Promise<FocusTask[]> {
  return (await native.listFocusTasks()).tasks
}

export function createIOSFocusTask(
  title: string,
  category: FocusTaskCategory,
  priority: FocusTaskPriority,
  isFocus = false,
  dueDate?: string,
  itemType: FocusTask['item_type'] = 'TASK',
): Promise<FocusTask> {
  return native.createFocusTask({ title, category, priority, isFocus, itemType, ...(dueDate ? { dueDate } : {}) })
}

export function updateIOSFocusTask(
  id: number,
  updates: Partial<Pick<FocusTask, 'title' | 'category' | 'priority' | 'completed' | 'is_focus'>>,
): Promise<FocusTask> {
  return native.updateFocusTask({
    id,
    ...(updates.title !== undefined ? { title: updates.title } : {}),
    ...(updates.category !== undefined ? { category: updates.category } : {}),
    ...(updates.priority !== undefined ? { priority: updates.priority } : {}),
    ...(updates.completed !== undefined ? { completed: updates.completed } : {}),
    ...(updates.is_focus !== undefined ? { isFocus: updates.is_focus } : {}),
  })
}

export function deleteIOSFocusTask(id: number): Promise<void> {
  return native.deleteFocusTask({ id })
}

export function analyzeIOSFocusInput(text: string): Promise<FocusAnalyzePreview> {
  return native.analyzeFocusInput({ text })
}

export async function getIOSFocusThink(query: string): Promise<string> {
  return (await native.focusThink({ query })).suggestion
}

export function saveIOSFocusIdea(content: string): Promise<void> {
  return native.saveFocusIdea({ content })
}

export function saveIOSFocusDecision(content: string): Promise<void> {
  return native.saveFocusDecision({ content })
}

export async function listIOSFocusTimeline(): Promise<FocusTimelineEvent[]> {
  return (await native.listFocusTimeline()).events
}

export async function listIOSFocusInbox(): Promise<FocusInboxItem[]> {
  return (await native.listFocusInbox()).items
}

export function updateIOSFocusInbox(id: number, status: 'approved' | 'ignored'): Promise<void> {
  return native.updateFocusInbox({ id, status })
}

export function syncIOSFocusNotifications(): Promise<{ scheduled: number; authorized: boolean }> {
  return native.syncFocusNotifications()
}

export async function startIOSSpeechRecognition(
  recordingId: string,
  onUpdate: (event: { text: string; isFinal: boolean; volume: number; recordingId: string }) => void,
): Promise<PluginListenerHandle> {
  const listener = await native.addListener('speechRecognitionUpdate', onUpdate)
  try {
    await native.startSpeechRecognition({ recordingId })
    return listener
  } catch (error) {
    await listener.remove()
    throw error
  }
}

export function stopIOSSpeechRecognition(recordingId: string): Promise<{ text: string; recordingId: string }> {
  return native.stopSpeechRecognition({ recordingId })
}

export function cancelIOSSpeechRecognition(recordingId?: string): Promise<void> {
  return native.cancelSpeechRecognition(recordingId ? { recordingId } : {})
}

export async function streamIOSLocalChat(
  payload: { text?: string; sessionId?: string },
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const text = payload.text?.trim()
  const sessionId = payload.sessionId
  if (!text || !sessionId) throw new Error('Mensagem e conversa são obrigatórias no modo local do iPhone.')

  const generationId = crypto.randomUUID()
  let rawStreamedText = ''
  let visibleStreamedText = ''
  const listener = await native.addListener('chatToken', event => {
    if (event.generationId !== generationId || !event.content) return
    rawStreamedText += event.content
    const nextVisibleText = stripInternalReasoning(rawStreamedText, true)
    if (nextVisibleText === visibleStreamedText) return
    if (nextVisibleText.startsWith(visibleStreamedText)) {
      onEvent({
        type: 'token',
        content: nextVisibleText.slice(visibleStreamedText.length),
        model: event.model,
      })
    } else {
      onEvent({ type: 'replace_response', content: nextVisibleText, model: event.model })
    }
    visibleStreamedText = nextVisibleText
  })
  const abort = () => { void native.stopGeneration({ generationId }) }
  signal?.addEventListener('abort', abort, { once: true })

  try {
    if (signal?.aborted) throw new DOMException('Operação cancelada', 'AbortError')
    const result = await native.generate({ sessionId, text, generationId })
    if (signal?.aborted || result.generationId !== generationId) {
      throw new DOMException('Operação cancelada', 'AbortError')
    }
    const finalText = stripInternalReasoning(result.text).trim()
    if (finalText && finalText !== visibleStreamedText) {
      onEvent({ type: 'replace_response', content: finalText, model: result.model })
    }
    if (result.session) onEvent({ type: 'session_update', session: result.session })
    if (result.metrics) console.info('[BudsPerf]', result.metrics)
    onEvent({ type: 'done', model: result.model, pipeline: 'IPHONE_LOCAL' })
  } finally {
    signal?.removeEventListener('abort', abort)
    await listener.remove()
  }
}
