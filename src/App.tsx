import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import './App.css'

type Comment = {
  id: string
  author: string
  text: string
  createdAt: string
  quote: string
  type: 'underline' | 'highlight'
  parentCommentId?: string | null
  replies?: Comment[]
}

type Book = {
  id: string
  title: string
  author: string
  content: string
  comments: Comment[]
}

type ClubMember = {
  id: string
  displayName: string
  email: string
  commentColor: string
}

type Club = {
  id: string
  name: string
  summary: string
  books: Book[]
  members?: ClubMember[]
}

type UserProfile = {
  displayName: string
  email: string
  commentColor: string
}

type AppState = {
  clubs: Club[]
  userProfile: UserProfile
}

const STORAGE_KEY = 'fabil-book-club-v1'
const DEFAULT_COMMENT_COLOR = '#a56cc7'
const PAGE_CHARACTER_TARGET = 1600
const API_BASE_URL = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '').trim().replace(/\/$/, '')

type ApiCommentDocument = {
  id: string
  bookId: string
  author: string
  text: string
  quote: string
  type: 'underline' | 'highlight'
  createdAt: string
  parentCommentId?: string | null
}

type ApiCatalogBook = {
  id: string
  title: string
  author: string
  content: string
}

type ApiCatalogClub = {
  id: string
  name: string
  summary: string
  books: ApiCatalogBook[]
  members?: ClubMember[]
}

function memberId(displayName: string, email: string): string {
  const normalizedName = displayName.trim().toLowerCase().replace(/\s+/g, '-')
  const normalizedEmail = email.trim().toLowerCase()
  const basis = normalizedEmail || normalizedName || crypto.randomUUID()
  return `member-${basis.replace(/[^a-z0-9@._-]/g, '')}`
}

function normalizeClubMembers(members: ClubMember[] | undefined): ClubMember[] {
  if (!Array.isArray(members)) {
    return []
  }

  return members
    .filter((member) => member && typeof member.displayName === 'string' && member.displayName.trim())
    .map((member) => {
      const displayName = member.displayName.trim()
      const email = typeof member.email === 'string' ? member.email.trim() : ''
      const commentColor =
        typeof member.commentColor === 'string' && member.commentColor ? member.commentColor : DEFAULT_COMMENT_COLOR

      return {
        id: typeof member.id === 'string' && member.id ? member.id : memberId(displayName, email),
        displayName,
        email,
        commentColor,
      }
    })
}

type AuthUser = {
  googleId: string
  displayName: string
  email: string
  commentColor: string
  avatarUrl: string
}

type AuthResponse =
  | {
      authenticated: true
      user: AuthUser
    }
  | {
      authenticated: false
    }

function apiUrl(path: string): string {
  return API_BASE_URL ? `${API_BASE_URL}${path}` : path
}

function normalizeBasePath(pathname: string): string {
  const withoutIndex = pathname.replace(/\/index\.html$/i, '')
  const trimmed = withoutIndex.replace(/\/+$/, '')
  return trimmed || '/'
}

function joinPath(base: string, segment: string): string {
  if (base === '/') {
    return `/${segment}`
  }

  return `${base}/${segment}`
}

function frontendBaseUrl(): string {
  const basePath = normalizeBasePath(window.location.pathname)
  return `${window.location.origin}${basePath === '/' ? '' : basePath}`
}

const EXAMPLE_TEXT = `Chapter 1\n\nThe old library clock sang six notes when Mira stepped into the reading room. Dust floated like quiet applause in the gold light, and every table held the gentle evidence of shared attention: a pencil left open to a margin, a tea stain shaped like a crescent moon, a folded page waiting for a friend to catch up.\n\nShe opened the book to the marked chapter and smiled at the underline that someone had drawn beneath a single sentence: "A story is only finished when someone else reads it."\n\nChapter 2\n\nBy the second week, the club began to notice each other in the annotations. Theo circled difficult words and wrote definitions in tiny, careful letters. Hana asked bold questions in the margins. Jules answered those questions two pages later. What began as solitary reading became a conversation unfolding in ink and time.`

const initialState: AppState = {
  clubs: [
    {
      id: 'demo-club',
      name: 'Moonlight Readers',
      summary: 'A cozy group reading modern fiction one chapter at a time.',
      members: [
        {
          id: 'member-sam',
          displayName: 'Sam',
          email: '',
          commentColor: DEFAULT_COMMENT_COLOR,
        },
      ],
      books: [
        {
          id: 'demo-book',
          title: 'The Shared Margin',
          author: 'A. Novell',
          content: EXAMPLE_TEXT,
          comments: [],
        },
      ],
    },
  ],
  userProfile: {
    displayName: 'Sam',
    email: '',
    commentColor: DEFAULT_COMMENT_COLOR,
  },
}

function readSavedState(): AppState {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return initialState
  }

  try {
    const parsed = JSON.parse(raw) as Partial<AppState> & {
      userProfile?: Partial<UserProfile>
    }
    const clubs: Club[] = Array.isArray(parsed.clubs)
      ? parsed.clubs.map((club): Club => ({
          ...club,
          members: normalizeClubMembers(club.members),
          books: Array.isArray(club.books)
            ? club.books.map((book): Book => ({
                ...book,
                comments: Array.isArray(book.comments)
                  ? book.comments.map((comment): Comment => {
                      const normalizedType: Comment['type'] =
                        comment && typeof comment === 'object' && 'type' in comment && comment.type === 'highlight'
                          ? 'highlight'
                          : 'underline'

                      return {
                        ...comment,
                        type: normalizedType,
                      }
                    })
                  : [],
              }))
            : [],
        }))
      : initialState.clubs
    const displayName =
      typeof parsed.userProfile?.displayName === 'string' && parsed.userProfile.displayName.trim()
        ? parsed.userProfile.displayName
        : initialState.userProfile.displayName
    const email =
      typeof parsed.userProfile?.email === 'string' ? parsed.userProfile.email : initialState.userProfile.email
    const commentColor =
      typeof parsed.userProfile?.commentColor === 'string' && parsed.userProfile.commentColor
        ? parsed.userProfile.commentColor
        : initialState.userProfile.commentColor

    return {
      clubs,
      userProfile: {
        displayName,
        email,
        commentColor,
      },
    }
  } catch {
    return initialState
  }
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

function overlapsSelection(existingQuote: string, selectedText: string): boolean {
  const a = existingQuote.trim().toLowerCase()
  const b = selectedText.trim().toLowerCase()

  if (!a || !b) {
    return false
  }

  return a === b || a.includes(b) || b.includes(a)
}

function paginateContent(content: string): string[] {
  const blocks = content.split(/\n{2,}/)
  if (!blocks.length) {
    return [content]
  }

  const pages: string[] = []
  let currentPage = ''

  blocks.forEach((block) => {
    const nextBlock = block.trim()
    if (!nextBlock) {
      return
    }

    const candidate = currentPage ? `${currentPage}\n\n${nextBlock}` : nextBlock
    if (currentPage && candidate.length > PAGE_CHARACTER_TARGET) {
      pages.push(currentPage)
      currentPage = nextBlock
      return
    }

    currentPage = candidate
  })

  if (currentPage) {
    pages.push(currentPage)
  }

  return pages.length ? pages : [content]
}

function mapApiCommentsToTree(documents: ApiCommentDocument[]): Comment[] {
  const byId = new Map<string, Comment>()

  documents.forEach((document) => {
    byId.set(document.id, {
      id: document.id,
      author: document.author,
      text: document.text,
      createdAt: document.createdAt,
      quote: document.quote,
      type: document.type,
      parentCommentId: document.parentCommentId ?? null,
      replies: [],
    })
  })

  const roots: Comment[] = []

  documents.forEach((document) => {
    const current = byId.get(document.id)
    if (!current) {
      return
    }

    const parentId = document.parentCommentId ?? null
    if (!parentId) {
      roots.push(current)
      return
    }

    const parent = byId.get(parentId)
    if (!parent) {
      roots.push(current)
      return
    }

    parent.replies = [...(parent.replies ?? []), current]
  })

  const normalizeReplies = (comment: Comment): Comment => {
    const replies = comment.replies?.map(normalizeReplies) ?? []
    return {
      ...comment,
      replies: replies.length ? replies : undefined,
    }
  }

  return roots.map(normalizeReplies)
}

async function fetchBookComments(bookId: string): Promise<Comment[]> {
  const response = await fetch(apiUrl(`/api/comments?bookId=${encodeURIComponent(bookId)}`))
  if (!response.ok) {
    throw new Error(`Failed to fetch comments (${response.status}).`)
  }

  const documents = (await response.json()) as ApiCommentDocument[]
  return mapApiCommentsToTree(documents)
}

async function saveComment(bookId: string, comment: Comment, parentCommentId: string | null): Promise<Comment> {
  const response = await fetch(apiUrl('/api/comments'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: comment.id,
      bookId,
      author: comment.author,
      text: comment.text,
      quote: comment.quote,
      type: comment.type,
      parentCommentId,
    }),
  })

  if (!response.ok) {
    throw new Error(`Failed to save comment (${response.status}).`)
  }

  const saved = (await response.json()) as ApiCommentDocument
  return {
    id: saved.id,
    author: saved.author,
    text: saved.text,
    createdAt: saved.createdAt,
    quote: saved.quote,
    type: saved.type,
    parentCommentId: saved.parentCommentId ?? null,
    replies: [],
  }
}

async function fetchCatalog(): Promise<Club[]> {
  const response = await fetch(apiUrl('/api/catalog'))
  if (!response.ok) {
    throw new Error(`Failed to fetch catalog (${response.status}).`)
  }

  const clubs = (await response.json()) as ApiCatalogClub[]
  return clubs.map((club) => ({
    id: club.id,
    name: club.name,
    summary: club.summary,
    books: (club.books ?? []).map((book) => ({
      id: book.id,
      title: book.title,
      author: book.author,
      content: book.content,
      comments: [],
    })),
    members: normalizeClubMembers(club.members),
  }))
}

async function syncCatalog(clubs: Club[], userProfile: UserProfile, selectedClubId: string): Promise<void> {
  const response = await fetch(apiUrl('/api/catalog-sync'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      clubs: clubs.map((club) => ({
        id: club.id,
        name: club.name,
        summary: club.summary,
        members: normalizeClubMembers(club.members),
        books: club.books.map((book) => ({
          id: book.id,
          title: book.title,
          author: book.author,
          content: book.content,
        })),
      })),
      userProfile,
      selectedClubId,
    }),
  })

  if (!response.ok) {
    throw new Error(`Failed to sync catalog (${response.status}).`)
  }
}

async function fetchAuthSession(): Promise<AuthResponse> {
  const response = await fetch(apiUrl('/auth/me'), {
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error(`Failed to load auth session (${response.status}).`)
  }

  return (await response.json()) as AuthResponse
}

async function signOut(): Promise<void> {
  const response = await fetch(apiUrl('/auth/logout'), {
    method: 'POST',
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error(`Failed to log out (${response.status}).`)
  }
}

function App() {
  const [state, setState] = useState<AppState>(() => readSavedState())
  const [authLoading, setAuthLoading] = useState(true)
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [selectedClubId, setSelectedClubId] = useState<string>(state.clubs[0]?.id ?? '')
  const [selectedBookId, setSelectedBookId] = useState<string>(state.clubs[0]?.books[0]?.id ?? '')
  const [clubMenuOpen, setClubMenuOpen] = useState(false)
  const [bookModalOpen, setBookModalOpen] = useState(false)
  const [clubSettingsOpen, setClubSettingsOpen] = useState(false)

  const [clubName, setClubName] = useState('')
  const [clubSummary, setClubSummary] = useState('')
  const [memberName, setMemberName] = useState('')
  const [memberEmail, setMemberEmail] = useState('')
  const [memberColor, setMemberColor] = useState(DEFAULT_COMMENT_COLOR)

  const [bookTitle, setBookTitle] = useState('')
  const [bookAuthor, setBookAuthor] = useState('')
  const [bookContent, setBookContent] = useState('')
  const [commentStyleMode, setCommentStyleMode] = useState<'underline' | 'highlight'>('underline')
  const [readingMode, setReadingMode] = useState<'scroll' | 'paged'>('scroll')
  const [pageIndex, setPageIndex] = useState(0)
  const [commentDraftText, setCommentDraftText] = useState('')
  const [pendingQuote, setPendingQuote] = useState<string | null>(null)
  const [commentPopover, setCommentPopover] = useState<{
    quote: string
    left: number
    top: number
    mode: 'new' | 'existing' | 'edit' | 'reply' | 'thread'
    comment?: Comment
    comments?: Comment[]
  } | null>(null)

  const readingSurfaceRef = useRef<HTMLElement | null>(null)
  const selectionCheckTimeoutRef = useRef<number | null>(null)
  const initialCatalogLoadDoneRef = useRef(false)
  const initialCatalogSyncDoneRef = useRef(false)

  const [profileName, setProfileName] = useState(state.userProfile.displayName)
  const [profileEmail, setProfileEmail] = useState(state.userProfile.email)
  const [profileColor, setProfileColor] = useState(state.userProfile.commentColor)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  useEffect(() => {
    const loadSession = async () => {
      const authParam = new URLSearchParams(window.location.search).get('auth')
      const attempts = authParam === 'success' ? 8 : 3

      try {
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          const session = await fetchAuthSession()
          if (session.authenticated) {
            setAuthUser(session.user)

            if (authParam) {
              const cleanedUrl = new URL(window.location.href)
              cleanedUrl.searchParams.delete('auth')
              window.history.replaceState({}, '', cleanedUrl.toString())
            }

            return
          }

          if (attempt < attempts - 1) {
            await new Promise((resolve) => {
              window.setTimeout(resolve, 350)
            })
          }
        }

        setAuthUser(null)
      } catch (error) {
        console.error('Unable to load auth session.', error)
        setAuthUser(null)
      } finally {
        setAuthLoading(false)
      }
    }

    void loadSession()
  }, [])

  useEffect(() => {
    if (!authUser) {
      return
    }

    setState((prev) => ({
      ...prev,
      userProfile: {
        displayName: authUser.displayName,
        email: authUser.email,
        commentColor: authUser.commentColor || prev.userProfile.commentColor,
      },
    }))
  }, [authUser])

  useEffect(() => {
    if (initialCatalogLoadDoneRef.current) {
      return
    }

    initialCatalogLoadDoneRef.current = true

    const loadCatalog = async () => {
      try {
        const clubs = await fetchCatalog()
        if (!clubs.length) {
          return
        }

        setState((prev) => ({ ...prev, clubs }))
      } catch (error) {
        console.error('Unable to load catalog from API.', error)
      }
    }

    void loadCatalog()
  }, [])

  useEffect(() => {
    setProfileName(state.userProfile.displayName)
    setProfileEmail(state.userProfile.email)
    setProfileColor(state.userProfile.commentColor)
  }, [state.userProfile])

  const selectedClub = useMemo(
    () => state.clubs.find((club) => club.id === selectedClubId) ?? null,
    [state.clubs, selectedClubId],
  )

  const selectedBook = useMemo(
    () => selectedClub?.books.find((book) => book.id === selectedBookId) ?? null,
    [selectedClub, selectedBookId],
  )

  const selectedClubMembers = useMemo(() => normalizeClubMembers(selectedClub?.members), [selectedClub])

  const colorForAuthor = (author: string): string => {
    const normalizedAuthor = author.trim().toLowerCase()
    const match = selectedClubMembers.find((member) => member.displayName.trim().toLowerCase() === normalizedAuthor)
    return match?.commentColor || DEFAULT_COMMENT_COLOR
  }

  const pagedContent = useMemo(() => {
    if (!selectedBook) {
      return []
    }

    return paginateContent(selectedBook.content)
  }, [selectedBook])

  const activeReadingContent =
    selectedBook && readingMode === 'paged' ? (pagedContent[pageIndex] ?? '') : (selectedBook?.content ?? '')

  useEffect(() => {
    if (!state.clubs.length) {
      if (selectedClubId !== '') {
        setSelectedClubId('')
      }
      if (selectedBookId !== '') {
        setSelectedBookId('')
      }
      return
    }

    if (!state.clubs.some((club) => club.id === selectedClubId)) {
      const nextClub = state.clubs[0]
      setSelectedClubId(nextClub.id)
      setSelectedBookId(nextClub.books[0]?.id ?? '')
      return
    }

    const club = state.clubs.find((item) => item.id === selectedClubId)
    if (!club) {
      return
    }

    if (!club.books.some((book) => book.id === selectedBookId)) {
      setSelectedBookId(club.books[0]?.id ?? '')
    }
  }, [state.clubs, selectedClubId, selectedBookId])

  useEffect(() => {
    setPageIndex(0)
    setPendingQuote(null)
    setCommentPopover(null)
  }, [selectedBookId, readingMode])

  useEffect(() => {
    if (!pagedContent.length) {
      if (pageIndex !== 0) {
        setPageIndex(0)
      }
      return
    }

    if (pageIndex > pagedContent.length - 1) {
      setPageIndex(pagedContent.length - 1)
    }
  }, [pagedContent, pageIndex])

  useEffect(() => {
    if (initialCatalogSyncDoneRef.current || !selectedClubId) {
      return
    }

    initialCatalogSyncDoneRef.current = true

    const syncInitialCatalog = async () => {
      try {
        await syncCatalog(state.clubs, state.userProfile, selectedClubId)
      } catch (error) {
        console.error('Unable to sync initial catalog to API.', error)
      }
    }

    void syncInitialCatalog()
  }, [selectedClubId, state.clubs, state.userProfile])

  useEffect(() => {
    if (!selectedClubId || !selectedBookId) {
      return
    }

    let cancelled = false

    const loadComments = async () => {
      try {
        const comments = await fetchBookComments(selectedBookId)
        if (cancelled) {
          return
        }

        setState((prev) => ({
          ...prev,
          clubs: prev.clubs.map((club) =>
            club.id === selectedClubId
              ? {
                  ...club,
                  books: club.books.map((book) =>
                    book.id === selectedBookId ? { ...book, comments } : book,
                  ),
                }
              : club,
          ),
        }))
      } catch (error) {
        console.error('Unable to load comments from API.', error)
      }
    }

    void loadComments()

    const refreshHandle = window.setInterval(() => {
      void loadComments()
    }, 4000)

    return () => {
      cancelled = true
      window.clearInterval(refreshHandle)
    }
  }, [selectedBookId, selectedClubId])

  function createClub(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = clubName.trim()
    const summary = clubSummary.trim()
    if (!name || !summary) {
      return
    }

    const ownerMember: ClubMember = {
      id: memberId(state.userProfile.displayName, state.userProfile.email),
      displayName: state.userProfile.displayName,
      email: state.userProfile.email,
      commentColor: state.userProfile.commentColor,
    }

    const newClub: Club = {
      id: uid('club'),
      name,
      summary,
      books: [],
      members: [ownerMember],
    }

    const nextClubs = [newClub, ...state.clubs]

    setState((prev) => ({ ...prev, clubs: nextClubs }))
    setSelectedClubId(newClub.id)
    setSelectedBookId('')
    setClubName('')
    setClubSummary('')
    setClubMenuOpen(false)

    void syncCatalog(nextClubs, state.userProfile, newClub.id).catch((error) => {
      console.error('Unable to sync clubs to API.', error)
    })
  }

  function openClubSettings() {
    setMemberName(state.userProfile.displayName)
    setMemberEmail(state.userProfile.email)
    setMemberColor(state.userProfile.commentColor)
    setClubSettingsOpen(true)
  }

  function addClubMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedClub) {
      return
    }

    const displayName = memberName.trim()
    const email = memberEmail.trim().toLowerCase()
    if (!displayName) {
      return
    }

    const nextMember: ClubMember = {
      id: memberId(displayName, email),
      displayName,
      email,
      commentColor: memberColor,
    }

    const existingMembers = normalizeClubMembers(selectedClub.members)
    const duplicateIndex = existingMembers.findIndex((member) =>
      email ? member.email.toLowerCase() === email : member.displayName.toLowerCase() === displayName.toLowerCase(),
    )

    const nextMembers =
      duplicateIndex >= 0
        ? existingMembers.map((member, index) =>
            index === duplicateIndex
              ? {
                  ...member,
                  displayName,
                  email,
                  commentColor: memberColor,
                }
              : member,
          )
        : [...existingMembers, nextMember]

    const nextClubs = state.clubs.map((club) =>
      club.id === selectedClub.id ? { ...club, members: nextMembers } : club,
    )

    setState((prev) => ({
      ...prev,
      clubs: nextClubs,
    }))

    void syncCatalog(nextClubs, state.userProfile, selectedClub.id).catch((error) => {
      console.error('Unable to sync club members to API.', error)
    })

    setMemberName('')
    setMemberEmail('')
    setMemberColor(DEFAULT_COMMENT_COLOR)
  }

  function removeClubMember(memberToRemove: ClubMember) {
    if (!selectedClub) {
      return
    }

    const nextMembers = normalizeClubMembers(selectedClub.members).filter((member) => member.id !== memberToRemove.id)
    const nextClubs = state.clubs.map((club) =>
      club.id === selectedClub.id ? { ...club, members: nextMembers } : club,
    )

    setState((prev) => ({
      ...prev,
      clubs: nextClubs,
    }))

    void syncCatalog(nextClubs, state.userProfile, selectedClub.id).catch((error) => {
      console.error('Unable to sync club members to API.', error)
    })
  }

  function createBook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedClub) {
      return
    }

    const title = bookTitle.trim()
    const author = bookAuthor.trim()
    const content = bookContent.trim()
    if (!title || !author || !content) {
      return
    }

    const newBook: Book = {
      id: uid('book'),
      title,
      author,
      content,
      comments: [],
    }

    const nextClubs = state.clubs.map((club) =>
      club.id === selectedClub.id ? { ...club, books: [newBook, ...club.books] } : club,
    )

    setState((prev) => ({
      ...prev,
      clubs: nextClubs,
    }))
    setSelectedBookId(newBook.id)
    setBookTitle('')
    setBookAuthor('')
    setBookContent('')
    setBookModalOpen(false)

    void syncCatalog(nextClubs, state.userProfile, selectedClub.id).catch((error) => {
      console.error('Unable to sync books to API.', error)
    })
  }

  function handleReadingSelection() {
    if (!selectedBook) {
      return
    }

    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) {
      setPendingQuote(null)
      return
    }

    const selectedText = selection.toString().trim()
    if (!selectedText) {
      setPendingQuote(null)
      return
    }

    const range = selection.getRangeAt(0)
    const article = readingSurfaceRef.current
    if (!article || !article.contains(range.commonAncestorContainer)) {
      setPendingQuote(null)
      return
    }

    const rect = range.getBoundingClientRect()
    const relatedComments = selectedBook.comments.filter((comment) => overlapsSelection(comment.quote, selectedText))
    const exactMatch = selectedBook.comments.find((comment) => {
      const normalizedQuote = comment.quote.trim().toLowerCase()
      const normalizedSelection = selectedText.trim().toLowerCase()
      return normalizedQuote === normalizedSelection || normalizedQuote.includes(normalizedSelection)
    })

    const existingComment =
      exactMatch ??
      selectedBook.comments.find((comment) => comment.quote.trim().toLowerCase().includes(selectedText.trim().toLowerCase())) ??
      relatedComments[0]

    if (existingComment) {
      setPendingQuote(selectedText)
      setCommentPopover({
        quote: existingComment.quote,
        left: Math.min(window.innerWidth - 240, Math.max(20, rect.left + rect.width / 2 - 110)),
        top: Math.max(36, rect.top - 8),
        mode: 'existing',
        comment: existingComment,
      })
      setCommentDraftText('')
      selection.removeAllRanges()
      return
    }

    if (relatedComments.length > 0) {
      setPendingQuote(selectedText)
      setCommentPopover({
        quote: selectedText,
        left: Math.min(window.innerWidth - 240, Math.max(20, rect.left + rect.width / 2 - 110)),
        top: Math.max(36, rect.top - 8),
        mode: 'thread',
        comments: relatedComments,
      })
      setCommentDraftText('')
      selection.removeAllRanges()
      return
    }

    setPendingQuote(selectedText)
    setCommentPopover({
      quote: selectedText,
      left: Math.min(window.innerWidth - 240, Math.max(20, rect.left + rect.width / 2 - 110)),
      top: Math.max(36, rect.top - 8),
      mode: 'new',
    })
    setCommentDraftText('')
    selection.removeAllRanges()
  }

  function scheduleReadingSelectionCheck() {
    if (selectionCheckTimeoutRef.current !== null) {
      window.clearTimeout(selectionCheckTimeoutRef.current)
    }

    // Mobile browsers finalize range coordinates shortly after touchend.
    selectionCheckTimeoutRef.current = window.setTimeout(() => {
      handleReadingSelection()
    }, 120)
  }

  function openCommentBubble(quote: string, target: HTMLElement, comment?: Comment) {
    const rect = target.getBoundingClientRect()
    setCommentPopover({
      quote,
      left: Math.min(window.innerWidth - 240, Math.max(20, rect.left + rect.width / 2 - 110)),
      top: Math.max(36, rect.top - 8),
      mode: comment ? 'existing' : 'new',
      comment,
    })
    setCommentDraftText('')
  }

  function updateCommentTree(comments: Comment[], commentId: string, updater: (comment: Comment) => Comment): Comment[] {
    return comments.map((comment) => {
      if (comment.id === commentId) {
        return updater(comment)
      }

      if (comment.replies?.length) {
        return {
          ...comment,
          replies: updateCommentTree(comment.replies, commentId, updater),
        }
      }

      return comment
    })
  }

  function deleteCommentTree(comments: Comment[], commentId: string): Comment[] {
    return comments.flatMap((comment) => {
      if (comment.id === commentId) {
        return []
      }

      const nextReplies = comment.replies ? deleteCommentTree(comment.replies, commentId) : []
      return [{ ...comment, replies: nextReplies.length ? nextReplies : undefined }]
    })
  }

  async function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedClub || !selectedBook || !commentPopover) {
      return
    }

    const text = commentDraftText.trim()
    if (!text) {
      return
    }

    const parentCommentId = commentPopover.mode === 'reply' && commentPopover.comment ? commentPopover.comment.id : null

    const pendingComment: Comment = {
      id: uid('comment'),
      author: state.userProfile.displayName.trim() || 'You',
      text,
      quote: commentPopover.quote,
      createdAt: new Date().toISOString(),
      type: commentStyleMode,
      parentCommentId,
      replies: [],
    }

    let newComment: Comment

    try {
      newComment = await saveComment(selectedBook.id, pendingComment, parentCommentId)
    } catch (error) {
      console.error('Unable to save comment to API.', error)
      return
    }

    setState((prev) => ({
      ...prev,
      clubs: prev.clubs.map((club) => {
        if (club.id !== selectedClub.id) {
          return club
        }

        return {
          ...club,
          books: club.books.map((book) => {
            if (book.id !== selectedBook.id) {
              return book
            }

            if (commentPopover.mode === 'reply' && commentPopover.comment) {
              return {
                ...book,
                comments: updateCommentTree(book.comments, commentPopover.comment.id, (comment) => ({
                  ...comment,
                  replies: [...(comment.replies ?? []), newComment],
                })),
              }
            }

            return { ...book, comments: [newComment, ...book.comments] }
          }),
        }
      }),
    }))

    setPendingQuote(null)
    setCommentPopover({
      quote: newComment.quote,
      left: commentPopover.left,
      top: commentPopover.top,
      mode: 'existing',
      comment: newComment,
    })
    setCommentDraftText('')
  }

  function updateComment(commentId: string, nextText: string) {
    if (!selectedClub || !selectedBook) {
      return
    }

    const trimmed = nextText.trim()

    setState((prev) => ({
      ...prev,
      clubs: prev.clubs.map((club) => {
        if (club.id !== selectedClub.id) {
          return club
        }

        return {
          ...club,
          books: club.books.map((book) =>
            book.id === selectedBook.id
              ? {
                  ...book,
                  comments: updateCommentTree(book.comments, commentId, (comment) => ({
                    ...comment,
                    text: trimmed,
                  })),
                }
              : book,
          ),
        }
      }),
    }))

    setCommentPopover(null)
    setCommentDraftText('')
  }

  function deleteComment(commentId: string) {
    if (!selectedClub || !selectedBook) {
      return
    }

    setState((prev) => ({
      ...prev,
      clubs: prev.clubs.map((club) => {
        if (club.id !== selectedClub.id) {
          return club
        }

        return {
          ...club,
          books: club.books.map((book) =>
            book.id === selectedBook.id
              ? { ...book, comments: deleteCommentTree(book.comments, commentId) }
              : book,
          ),
        }
      }),
    }))

    setCommentPopover(null)
    setCommentDraftText('')
  }

  function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const displayName = profileName.trim()
    if (!displayName) {
      return
    }

    const nextUserProfile: UserProfile = {
      displayName,
      email: profileEmail.trim(),
      commentColor: profileColor,
    }

    setState((prev) => ({
      ...prev,
      userProfile: nextUserProfile,
    }))

    if (selectedClubId) {
      void syncCatalog(state.clubs, nextUserProfile, selectedClubId).catch((error) => {
        console.error('Unable to sync user profile to API.', error)
      })
    }
  }
/*
  function startGoogleSignIn() {
    const basePath = normalizeBasePath(window.location.pathname)
    const authPath = joinPath(basePath, 'auth/google')
    const frontendUrl = encodeURIComponent(frontendBaseUrl())
    const authEndpoint = API_BASE_URL ? `${API_BASE_URL}${authPath}` : `${authPath}`
    window.location.href = `${authEndpoint}?frontendUrl=${frontendUrl}`
  }
*/
  function startGoogleSignIn() {
  const frontendUrl = encodeURIComponent(frontendBaseUrl())
  window.location.href = `${API_BASE_URL}/auth/google?frontendUrl=${frontendUrl}`
}

  async function handleSignOut() {
    try {
      await signOut()
    } catch (error) {
      console.error('Unable to sign out.', error)
    } finally {
      setAuthUser(null)
      setAuthLoading(false)
    }
  }

  if (authLoading) {
    return (
      <div className="app-shell">
        <main className="home-grid settings-grid">
          <section className="panel settings-panel">
            <h2>Signing in...</h2>
            <p>Checking your session.</p>
          </section>
        </main>
      </div>
    )
  }

  if (!authUser) {
    return (
      <div className="landing-shell">
        <main className="landing-card" aria-label="MARIK homepage">
          <span className="landing-badge">MARIK</span>
          <h1>Welcome to MARIK</h1>
          <p>Meow meow meow!</p>
          <div className="landing-actions">
            <button type="button" className="landing-google-button" onClick={startGoogleSignIn}>
              Sign in with Google
            </button>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="club-switcher app-header-left">
          <button
            type="button"
            className="club-switcher-button"
            aria-haspopup="dialog"
            aria-expanded={clubMenuOpen}
            aria-label={selectedClub ? `Active club: ${selectedClub.name}` : 'Choose a club'}
            onClick={() => setClubMenuOpen((open) => !open)}
          >
            <span className="club-switcher-icon">{selectedClub ? selectedClub.name.slice(0, 2).toUpperCase() : 'CL'}</span>
            <span className="club-switcher-copy">
              <strong>{selectedClub?.name ?? 'Choose club'}</strong>
              <small>{state.clubs.length ? 'Active club' : 'No clubs yet'}</small>
            </span>
          </button>

          {clubMenuOpen ? (
            <div className="club-switcher-menu" role="dialog" aria-label="Club selector">
              <div className="club-switcher-menu-section">
                <p className="club-switcher-label">Switch club</p>
                <ul className="club-list club-switcher-list">
                  {state.clubs.map((club) => (
                    <li key={club.id}>
                      <button
                        type="button"
                        className={club.id === selectedClubId ? 'club-pill active' : 'club-pill'}
                        onClick={() => {
                          setSelectedClubId(club.id)
                          setSelectedBookId(club.books[0]?.id ?? '')
                          setClubMenuOpen(false)
                        }}
                      >
                        <span>{club.name}</span>
                        <small>{club.books.length} books</small>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="club-switcher-menu-section">
                <p className="club-switcher-label">Add club</p>
                <form className="stack club-switcher-form" onSubmit={createClub}>
                  <label>
                    Club name
                    <input
                      type="text"
                      value={clubName}
                      onChange={(event) => setClubName(event.target.value)}
                      placeholder="Sunset Classics"
                      required
                    />
                  </label>
                  <label>
                    What is this club about?
                    <textarea
                      value={clubSummary}
                      onChange={(event) => setClubSummary(event.target.value)}
                      placeholder="We read one chapter every Friday."
                      rows={3}
                      required
                    />
                  </label>
                  <button type="submit">Create club</button>
                </form>
              </div>
            </div>
          ) : null}

        </div>

        <p className="app-brand" aria-label="Fabil brand">fabil</p>

        <nav className="top-nav" aria-label="Header navigation">
          <span className="top-nav-user" title={authUser.email}>{authUser.displayName}</span>
          <button type="button" className="top-nav-button" onClick={handleSignOut} aria-label="Sign out">
            <span aria-hidden="true">↗</span>
          </button>
          <NavLink
            to="/account"
            aria-label="Open account"
            className={({ isActive }) =>
              isActive ? 'top-nav-button profile-nav-button active' : 'top-nav-button profile-nav-button'
            }
            style={{ '--profile-accent': state.userProfile.commentColor } as CSSProperties}
          >
            <span aria-hidden="true">👤</span>
          </NavLink>
          <NavLink
            to="/settings"
            aria-label="Open settings"
            className={({ isActive }) => (isActive ? 'top-nav-button active' : 'top-nav-button')}
          >
            <span aria-hidden="true">⚙</span>
          </NavLink>
        </nav>
      </header>
 
      <Routes>
        <Route
          path="/"
          element={
            <main className="home-grid">
              <section className="panel books-panel">
                <div className="settings-head">
                  <h2>Books In Club</h2>
                  {selectedClub ? (
                    <button type="button" className="settings-home-link" onClick={openClubSettings}>
                      Manage club
                    </button>
                  ) : null}
                </div>
                {selectedClub ? (
                  <>
                    <p className="club-summary">{selectedClub.summary}</p>
                    <p className="club-summary">
                      Members: {normalizeClubMembers(selectedClub.members).length}
                    </p>
                    <ul className="book-list">
                      {selectedClub.books.map((book) => (
                        <li key={book.id}>
                          <NavLink
                            to="/reading"
                            className={book.id === selectedBookId ? 'book-jump active' : 'book-jump'}
                            onClick={() => setSelectedBookId(book.id)}
                          >
                            {book.title}
                          </NavLink>
                        </li>
                      ))}
                    </ul>

                    <button
                      type="button"
                      className="add-book-trigger"
                      onClick={() => setBookModalOpen(true)}
                    >
                      + Add book
                    </button>

                    {bookModalOpen ? (
                      <div className="modal-backdrop" role="presentation" onClick={() => setBookModalOpen(false)}>
                        <div
                          className="book-modal"
                          role="dialog"
                          aria-modal="true"
                          aria-label="Add a book to the club"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <div className="book-modal-head">
                            <h3>Add book</h3>
                            <button
                              type="button"
                              className="book-modal-close"
                              aria-label="Close add book window"
                              onClick={() => setBookModalOpen(false)}
                            >
                              Close
                            </button>
                          </div>
                          <form className="stack" onSubmit={createBook}>
                            <label>
                              Book title
                              <input
                                type="text"
                                value={bookTitle}
                                onChange={(event) => setBookTitle(event.target.value)}
                                placeholder="The Night Circus"
                                required
                              />
                            </label>
                            <label>
                              Author
                              <input
                                type="text"
                                value={bookAuthor}
                                onChange={(event) => setBookAuthor(event.target.value)}
                                placeholder="Erin Morgenstern"
                                required
                              />
                            </label>
                            <label>
                              Book text (or excerpt)
                              <textarea
                                value={bookContent}
                                onChange={(event) => setBookContent(event.target.value)}
                                placeholder="Paste chapters or reading excerpts here..."
                                rows={7}
                                required
                              />
                            </label>
                            <button type="submit">Add to club</button>
                          </form>
                        </div>
                      </div>
                    ) : null}

                    {clubSettingsOpen ? (
                      <div className="modal-backdrop" role="presentation" onClick={() => setClubSettingsOpen(false)}>
                        <div
                          className="book-modal"
                          role="dialog"
                          aria-modal="true"
                          aria-label="Manage club members"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <div className="book-modal-head">
                            <h3>Club settings</h3>
                            <button
                              type="button"
                              className="book-modal-close"
                              aria-label="Close club settings"
                              onClick={() => setClubSettingsOpen(false)}
                            >
                              Close
                            </button>
                          </div>

                          <div className="reading-notes">
                            <p className="reading-notes-label">Members</p>
                            <ul className="reading-note-list">
                              {normalizeClubMembers(selectedClub.members).map((member) => (
                                <li key={member.id} className="reading-note-item">
                                  <p className="reading-note-meta">
                                    {member.displayName}
                                    {member.email ? ` · ${member.email}` : ''}
                                  </p>
                                  <div className="comment-color-note">
                                    <span
                                      className="color-chip"
                                      style={{ '--chip-color': member.commentColor } as CSSProperties}
                                      aria-hidden="true"
                                    />
                                    <small>{member.commentColor}</small>
                                  </div>
                                  <button type="button" className="comment-inline-reply" onClick={() => removeClubMember(member)}>
                                    Remove
                                  </button>
                                </li>
                              ))}
                              {!normalizeClubMembers(selectedClub.members).length ? <li className="comment-empty">No members yet.</li> : null}
                            </ul>
                          </div>

                          <form className="stack" onSubmit={addClubMember}>
                            <label>
                              Member name
                              <input
                                type="text"
                                value={memberName}
                                onChange={(event) => setMemberName(event.target.value)}
                                placeholder="Alex"
                                required
                              />
                            </label>
                            <label>
                              Email (optional)
                              <input
                                type="email"
                                value={memberEmail}
                                onChange={(event) => setMemberEmail(event.target.value)}
                                placeholder="alex@example.com"
                              />
                            </label>
                            <label>
                              Member color
                              <input
                                type="color"
                                value={memberColor}
                                onChange={(event) => setMemberColor(event.target.value)}
                                className="color-picker-input"
                              />
                            </label>
                            <button type="submit">Add member</button>
                          </form>
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p>Create a club to start adding books.</p>
                )}
              </section>
            </main>
          }
        />

        <Route
          path="/reading"
          element={
            <main className="reading-grid">
              <section className="panel reading-panel">
                <NavLink to="/" className="reading-home-link" aria-label="Back to Home">
                  ←
                </NavLink>
                {selectedBook ? (
                  <>
                    <div className="reading-meta-row">
                      <p className="reading-meta">
                        {selectedBook.title} by {selectedBook.author}
                      </p>

                      <div className="reading-controls">
                        <div className="comment-style-toggle" aria-label="Comment style setting">
                          <button
                            type="button"
                            className={commentStyleMode === 'underline' ? 'comment-style-button active' : 'comment-style-button'}
                            onClick={() => {
                              setCommentStyleMode('underline')
                              setCommentPopover(null)
                            }}
                            aria-label="Underline comments"
                            aria-pressed={commentStyleMode === 'underline'}
                            title="Underline comments"
                          >
                            <span aria-hidden="true">U</span>
                          </button>
                          <button
                            type="button"
                            className={commentStyleMode === 'highlight' ? 'comment-style-button active' : 'comment-style-button'}
                            onClick={() => {
                              setCommentStyleMode('highlight')
                              setCommentPopover(null)
                            }}
                            aria-label="Highlight comments"
                            aria-pressed={commentStyleMode === 'highlight'}
                            title="Highlight comments"
                          >
                            <span aria-hidden="true">▣</span>
                          </button>
                        </div>

                        <div className="comment-style-toggle" aria-label="Reading mode setting">
                          <button
                            type="button"
                            className={readingMode === 'scroll' ? 'comment-style-button reading-mode-button active' : 'comment-style-button reading-mode-button'}
                            onClick={() => setReadingMode('scroll')}
                            aria-label="Infinite scroll mode"
                            aria-pressed={readingMode === 'scroll'}
                            title="Infinite scroll mode"
                          >
                            <span aria-hidden="true">∞</span>
                          </button>
                          <button
                            type="button"
                            className={readingMode === 'paged' ? 'comment-style-button reading-mode-button active' : 'comment-style-button reading-mode-button'}
                            onClick={() => setReadingMode('paged')}
                            aria-label="Page by page mode"
                            aria-pressed={readingMode === 'paged'}
                            title="Page by page mode"
                          >
                            <span aria-hidden="true">Pg</span>
                          </button>
                        </div>
                      </div>
                    </div>

                    <article
                      ref={readingSurfaceRef}
                      className="reading-surface"
                      onMouseUp={scheduleReadingSelectionCheck}
                      onTouchEnd={scheduleReadingSelectionCheck}
                      onClick={() => {
                        if (commentPopover && commentPopover.mode !== 'new') {
                          setCommentPopover(null)
                        }
                      }}
                    >
                      {(() => {
                        const annotationQuotes = [
                          ...selectedBook.comments.map((comment) => comment.quote),
                          ...(pendingQuote ? [pendingQuote] : []),
                        ]
                          .filter((quote) => quote && quote.trim())
                          .filter((quote, index, arr) => arr.indexOf(quote) === index)
                          .sort((a, b) => b.length - a.length)

                        if (!annotationQuotes.length) {
                          return activeReadingContent
                        }

                        const escapedQuotes = annotationQuotes.map((quote) => quote.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
                        const pattern = new RegExp(`(${escapedQuotes.join('|')})`, 'g')

                        return activeReadingContent.split(pattern).map((segment, index) => {
                          const existingComment = selectedBook.comments.find((comment) => comment.quote === segment)
                          const isPending = pendingQuote === segment && !existingComment

                          if (!existingComment && !isPending) {
                            return <span key={`plain-${index}`}>{segment}</span>
                          }

                          const noteType = existingComment?.type ?? commentStyleMode
                          const className = noteType === 'underline' ? 'comment-annotation underline' : 'comment-annotation highlight'
                          const commentColor = existingComment
                            ? colorForAuthor(existingComment.author)
                            : state.userProfile.commentColor

                          return (
                            <span
                              key={`${existingComment?.id ?? 'pending'}-${index}`}
                              className={className}
                              style={{ '--comment-accent': commentColor } as CSSProperties}
                              onClick={(event) => {
                                if (existingComment) {
                                  openCommentBubble(existingComment.quote, event.currentTarget, existingComment)
                                  return
                                }

                                const relatedComments = selectedBook.comments.filter((comment) =>
                                  overlapsSelection(comment.quote, segment),
                                )

                                if (relatedComments.length > 0) {
                                  const rect = event.currentTarget.getBoundingClientRect()
                                  setCommentPopover({
                                    quote: segment,
                                    left: Math.min(window.innerWidth - 240, Math.max(20, rect.left + rect.width / 2 - 110)),
                                    top: Math.max(36, rect.top - 8),
                                    mode: 'thread',
                                    comments: relatedComments,
                                  })
                                  return
                                }

                                openCommentBubble(segment, event.currentTarget)
                              }}
                            >
                              {segment}
                            </span>
                          )
                        })
                      })()}
                    </article>

                    {readingMode === 'paged' && pagedContent.length > 1 ? (
                      <div className="reading-pagination" aria-label="Page controls">
                        <button
                          type="button"
                          onClick={() => {
                            setPageIndex((current) => Math.max(0, current - 1))
                            setPendingQuote(null)
                            setCommentPopover(null)
                          }}
                          disabled={pageIndex === 0}
                        >
                          Previous
                        </button>
                        <p>
                          Page {pageIndex + 1} of {pagedContent.length}
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setPageIndex((current) => Math.min(pagedContent.length - 1, current + 1))
                            setPendingQuote(null)
                            setCommentPopover(null)
                          }}
                          disabled={pageIndex === pagedContent.length - 1}
                        >
                          Next
                        </button>
                      </div>
                    ) : null}

                    {commentPopover ? (
                      <div
                        className="comment-quick-popover"
                        style={{ left: commentPopover.left, top: commentPopover.top }}
                      >
                        {commentPopover.mode === 'thread' ? (
                          <div className="comment-thread-wrap">
                            <div className="comment-quick-head">
                              <span className="comment-quick-quote">Thread for “{commentPopover.quote}”</span>
                              <button
                                type="button"
                                className="comment-quick-close"
                                aria-label="Close thread"
                                onClick={() => setCommentPopover(null)}
                              >
                                ×
                              </button>
                            </div>

                            <div className="comment-thread-list">
                              {commentPopover.comments?.map((comment) => (
                                <button
                                  type="button"
                                  key={comment.id}
                                  className="comment-thread-item"
                                  onClick={() => {
                                    setCommentPopover({
                                      ...commentPopover,
                                      mode: 'existing',
                                      comment,
                                    })
                                  }}
                                >
                                  <span
                                    className="comment-thread-author"
                                    style={{ color: colorForAuthor(comment.author) }}
                                  >
                                    {comment.author}
                                  </span>
                                  <span className="comment-thread-text">{comment.text}</span>
                                </button>
                              ))}
                            </div>

                            <button
                              type="button"
                              className="comment-thread-add"
                              onClick={() => {
                                setCommentPopover({
                                  ...commentPopover,
                                  mode: 'new',
                                })
                              }}
                            >
                              Add a note
                            </button>
                          </div>
                        ) : null}

                        {commentPopover.mode === 'existing' && commentPopover.comment ? (
                          <div className="comment-inline-bubble-wrap">
                            <div className="comment-inline-thread">
                              <button
                                type="button"
                                className="comment-inline-bubble"
                                onClick={() => setCommentPopover(null)}
                              >
                                <span className="comment-inline-bubble-quote">“{commentPopover.comment.quote}”</span>
                                <span
                                  className="comment-inline-bubble-author"
                                  style={{ color: colorForAuthor(commentPopover.comment.author) }}
                                >
                                  {commentPopover.comment.author}
                                </span>
                                <span className="comment-inline-bubble-text">{commentPopover.comment.text}</span>
                              </button>

                              {commentPopover.comment.replies && commentPopover.comment.replies.length > 0 ? (
                                <div className="comment-replies-list">
                                  {commentPopover.comment.replies.map((reply) => (
                                    <div key={reply.id} className="comment-reply-item">
                                      <span
                                        className="comment-thread-author"
                                        style={{ color: colorForAuthor(reply.author) }}
                                      >
                                        {reply.author}
                                      </span>
                                      <span className="comment-thread-text">{reply.text}</span>
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                            </div>

                            <div className="comment-inline-actions" aria-label="Comment actions">
                              <button
                                type="button"
                                className="comment-inline-reply"
                                aria-label="Reply to comment"
                                title="Reply to comment"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  setCommentDraftText('')
                                  setCommentPopover({
                                    ...commentPopover,
                                    mode: 'reply',
                                  })
                                }}
                              >
                                Reply
                              </button>

                              {commentPopover.comment.author.trim().toLowerCase() ===
                                state.userProfile.displayName.trim().toLowerCase() ? (
                                <>
                                  <button
                                    type="button"
                                    className="comment-inline-action"
                                    aria-label="Edit comment"
                                    title="Edit comment"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      setCommentDraftText(commentPopover.comment?.text ?? '')
                                      setCommentPopover({
                                        ...commentPopover,
                                        mode: 'edit',
                                      })
                                    }}
                                  >
                                    ✎
                                  </button>
                                  <button
                                    type="button"
                                    className="comment-inline-action danger"
                                    aria-label="Delete comment"
                                    title="Delete comment"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      deleteComment(commentPopover.comment!.id)
                                    }}
                                  >
                                    🗑
                                  </button>
                                </>
                              ) : null}
                            </div>
                          </div>
                        ) : null}

                        {commentPopover.mode === 'reply' && commentPopover.comment ? (
                          <div className="comment-inline-bubble-wrap">
                            <div className="comment-inline-thread">
                              <button
                                type="button"
                                className="comment-inline-bubble"
                                onClick={() => setCommentPopover(null)}
                              >
                                <span className="comment-inline-bubble-quote">“{commentPopover.comment.quote}”</span>
                                <span
                                  className="comment-inline-bubble-author"
                                  style={{ color: colorForAuthor(commentPopover.comment.author) }}
                                >
                                  {commentPopover.comment.author}
                                </span>
                                <span className="comment-inline-bubble-text">{commentPopover.comment.text}</span>
                              </button>

                              {commentPopover.comment.replies && commentPopover.comment.replies.length > 0 ? (
                                <div className="comment-replies-list">
                                  {commentPopover.comment.replies.map((reply) => (
                                    <div key={reply.id} className="comment-reply-item">
                                      <span
                                        className="comment-thread-author"
                                        style={{ color: colorForAuthor(reply.author) }}
                                      >
                                        {reply.author}
                                      </span>
                                      <span className="comment-thread-text">{reply.text}</span>
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                            </div>

                            <form className="comment-inline-form" onSubmit={submitComment}>
                              <div className="comment-quick-head">
                                <span className="comment-quick-quote">Reply to thread</span>
                                <button
                                  type="button"
                                  className="comment-quick-close"
                                  aria-label="Close reply form"
                                  onClick={() => {
                                    setCommentPopover({
                                      ...commentPopover,
                                      mode: 'existing',
                                    })
                                    setCommentDraftText('')
                                  }}
                                >
                                  ×
                                </button>
                              </div>
                              <label className="comment-quick-label">
                                Add a reply
                                <textarea
                                  value={commentDraftText}
                                  onChange={(event) => setCommentDraftText(event.target.value)}
                                  rows={3}
                                />
                              </label>
                              <button type="submit" className="comment-quick-submit">Post reply</button>
                            </form>
                          </div>
                        ) : null}

                        {commentPopover.mode === 'edit' && commentPopover.comment ? (
                          <form
                            className="comment-inline-form"
                            onSubmit={(event) => {
                              event.preventDefault()
                              updateComment(commentPopover.comment!.id, commentDraftText)
                            }}
                          >
                            <div className="comment-quick-head">
                              <span className="comment-quick-quote">Edit note</span>
                              <button
                                type="button"
                                className="comment-quick-close"
                                aria-label="Close edit form"
                                onClick={() => {
                                  setCommentPopover({
                                    ...commentPopover,
                                    mode: 'existing',
                                  })
                                  setCommentDraftText('')
                                }}
                              >
                                ×
                              </button>
                            </div>
                            <label className="comment-quick-label">
                              Update your note
                              <textarea
                                value={commentDraftText}
                                onChange={(event) => setCommentDraftText(event.target.value)}
                                rows={3}
                              />
                            </label>
                            <button type="submit" className="comment-quick-submit">Save changes</button>
                          </form>
                        ) : null}

                        {commentPopover.mode === 'new' ? (
                          <form className="comment-inline-form" onSubmit={submitComment}>
                            <div className="comment-quick-head">
                              <span className="comment-quick-quote">“{commentPopover.quote}”</span>
                              <button
                                type="button"
                                className="comment-quick-close"
                                aria-label="Close comment prompt"
                                onClick={() => setCommentPopover(null)}
                              >
                                ×
                              </button>
                            </div>
                            <label className="comment-quick-label">
                              Add a note
                              <textarea
                                value={commentDraftText}
                                onChange={(event) => setCommentDraftText(event.target.value)}
                                rows={3}
                              />
                            </label>
                            <button type="submit" className="comment-quick-submit">Save note</button>
                          </form>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <>
                    <h2>Reading Room</h2>
                    <p>Select or add a book from Home to start reading.</p>
                  </>
                )}
              </section>
            </main>
          }
        />

        <Route
          path="/account"
          element={
            <main className="home-grid settings-grid">
              <section className="panel settings-panel">
                <div className="settings-head">
                  <h2>Account</h2>
                  <NavLink to="/" className="settings-home-link">Back to Home</NavLink>
                </div>
                <form id="account-form" className="stack" onSubmit={saveProfile}>
                  <label>
                    Display name
                    <input
                      type="text"
                      value={profileName}
                      onChange={(event) => setProfileName(event.target.value)}
                      placeholder="Sam"
                      required
                    />
                  </label>
                  <label>
                    Account email
                    <input
                      type="email"
                      value={profileEmail}
                      onChange={(event) => setProfileEmail(event.target.value)}
                      placeholder="sam@example.com"
                    />
                  </label>
                  <label>
                    Your comment color
                    <span
                      className="color-picker-wrap"
                      style={{ '--picker-color': profileColor } as CSSProperties}
                    >
                      <span className="color-picker-icon" aria-hidden="true">🎨</span>
                      <input
                        type="color"
                        value={profileColor}
                        onChange={(event) => setProfileColor(event.target.value)}
                        aria-label="Choose your comment highlight color"
                        className="color-picker-input"
                      />
                    </span>
                  </label>
                </form>
                <div className="account-color-preview" style={{ '--preview-color': profileColor } as CSSProperties}>
                  <span className="account-color-dot" aria-hidden="true" />
                  <p>
                    Comment preview in your color. This is how your notes will appear to you.
                  </p>
                </div>
                <p>
                  Your profile name and color are used when you post comments, so your own notes are easy to spot.
                </p>
                <button type="submit" form="account-form">Save account</button>
              </section>
            </main>
          }
        />

        <Route
          path="/settings"
          element={
            <main className="home-grid settings-grid">
              <section className="panel settings-panel">
                <div className="settings-head">
                  <h2>Settings</h2>
                  <NavLink to="/" className="settings-home-link">Back to Home</NavLink>
                </div>
                <p>More preferences are coming soon.</p>
              </section>
            </main>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}

export default App
