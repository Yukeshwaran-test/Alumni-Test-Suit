export const FIXTURES = {
  validCover: 'tests/fixtures/cover-1200x800.png',
  squareCover: 'tests/fixtures/cover-800x800.png',
  notAnImage: 'tests/fixtures/not-an-image.txt',
};

/** "Oct 15, 2026" — the format the wizard uses on screens 3–6. */
export function displayDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** A future date (15th of next month) as YYYY-MM-DD. */
function nextMonth15th() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  d.setDate(15);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function newEventData() {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
  const date = nextMonth15th();
  return {
    title: `QA Auto Event ${stamp}`,
    category: 'Seminar',
    date,
    description: 'Automated QA description for this event.',
    agenda: '10:00 Welcome, 11:00 Talk',
    whatToExpect: 'Networking with alumni and a panel discussion.',
    audience: 'all audience',
    session: {
      title: 'QA Session 1',
      start: '10:00',
      end: '12:00',
      agenda: 'Keynote and Q&A',
      link: 'https://meet.example.com/qa-session',
    },
    meal: 'Lunch',
    dietary: ['Vegetarian', 'Non-Vegetarian'],
    preEventQuestion: { text: 'Which session interests you most?', options: ['Keynote', 'Panel'] },
    feedbackQuestion: { text: 'How would you rate the session?', options: ['Good', 'Average'] },
  };
}

export type EventData = ReturnType<typeof newEventData>;
