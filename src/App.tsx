
import { createResource, createSignal, createMemo, For } from 'solid-js';
import ICAL from 'ical.js';

import { ical_client as ical_client_instance  } from './dav_client';
import type { CalendarEvent, CalendarEventDuration } from './types';

function App() {
  const [ical_client] = createResource(async () => {
    await ical_client_instance.login();
    return ical_client_instance;
  });
  const [calendars] = createResource(ical_client, (client) => client.fetchCalendars());
  const [startDate, setStartDate] = createSignal(new Date(new Date().setHours(0, 0, 0, 0))); // today at 12am
  const [endDate, setEndDate] = createSignal(new Date(new Date().setHours(23, 59, 59, 999) + 28 * 24 * 60 * 60 * 1000)); // 28 days from now at 11:59:59pm

  const [events] = createResource(
    () => {
      const client = ical_client();
      const cals = calendars();
      if (!client || !cals) return null;
      return { client, cals, start: startDate(), end: endDate() };
    },
    async ({ client, cals, start, end }) =>
      Promise.all(cals.map((cal) => client.fetchCalendarObjects({
        calendar: cal,
        timeRange: { start: start.toISOString(), end: end.toISOString() },
        expand: true,
        useMultiGet: true,
      }).then((events) => {
        console.log(`Events for calendar ${cal.displayName} from ${start.toISOString()} to ${end.toISOString()}:`, events);
        return events;
      }).catch((error) => {
        console.error(`Error getting events for calendar ${cal.displayName}`);
        console.error(error);
        return [];
      })))
  );

  const loading = createMemo(() => ical_client.loading || calendars.loading || events.loading);

  const eventsByDay = createMemo(() => {
    const evts = events();
    if (!evts) return {};
    const eventsByDay = evts.flat().reduce((acc, event) => {
      if (!event) return acc;
      const data = event.data;
      const parsedEvent = parseToCalendarEvent(data);
      // Use 'en-CA' locale to get YYYY-MM-DD format in local time (toISOString() uses UTC, which can shift dates for evening events)
      const day = parsedEvent.startDate.toLocaleDateString('en-CA');
      acc[day] = acc[day] || [];
      acc[day].push(parsedEvent);
      return acc;
    }, {} as Record<string, CalendarEvent[]>);
    for (const day in eventsByDay) {
      eventsByDay[day].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
    }
    return eventsByDay;
  });

  const displayedDays = createMemo(() => {
    let date = startDate();
    let day = date.getDay();
    day = day === 0 ? 7 : day;
    day-=1;
    const displayedDays: string[] = [];
    displayedDays.push(...Array.from({ length: day }, () => ""));
    while (date.getTime() < endDate().getTime()) {
      displayedDays.push(date.toISOString().split('T')[0]);
      date = new Date(date.getTime() + 24 * 60 * 60 * 1000);
    }
    return displayedDays;
  });
  
  return (
    <>
      <div style={{ display: 'flex', 'flex-direction': 'row', 'align-items': 'center', 'gap': '40px', 'font-size': '30px', 'margin-bottom': '30px'}}>
        <span style={{'font-size': '30px'}}>karson-cal</span>
        <div style={{ display: 'flex', 'flex-direction': 'row', gap: '10px', height: 'fit-content'}}>
          <input class="date-input" type="date" value={startDate().toISOString().split('T')[0]} onInput={(e) => setStartDate(new Date(e.target.value + 'T00:00:00'))} />
          <input class="date-input" type="date" value={endDate().toISOString().split('T')[0]} onInput={(e) => setEndDate(new Date(e.target.value + 'T00:00:00'))} />
        </div>
      </div>
      <div style={{ display: 'grid', 'grid-template-columns': 'repeat(7, 1fr)', 'column-gap': '10px', 'row-gap': '30px', width: "100%"}}>
        {loading() ? <div>Loading...</div> : (
          <For each={displayedDays()}>
            {(day) => day ? (
              <div style={{ display: 'flex', 'flex-direction': 'column', height: '100%', gap: '5px'}}>
                <span style={{ 'font-size': '16px' }}>{new Date(`${day}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'numeric', day: 'numeric' }).replace(",", "")}</span>
                <div class="event-container" style={{ display: 'flex', 'flex-direction': 'column', gap: '10px', height: '100%', 'min-height': '10px', padding: '5px' }}>
                  <For each={(eventsByDay()[day] ?? [])}>
                    {(event) => 
                      <span >
                        <span class="time-container" style={{ 'font-size': '12px', 'padding': '0px 2px' }}>
                          {event.allDayEvent ? `ALL DAY` : `${event.startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: 'numeric' }).toLowerCase().replace(" ", "")} - ${event.endDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: 'numeric', hour12: true }).toLowerCase().replace(" ", "")}`}
                        </span>
                        <span style={{ 'font-size': '16px' }}>{" "}{event.summary}</span>
                      </span>
                    }
                  </For>
                </div>
              </div>
            ) : <div />}
          </For>
        )}
      </div>
    </>
  );
}

export default App


/** adapted from [simple-caldav-client](https://github.com/TheJLifeX/simple-caldav-client) */
function parseToCalendarEvent(iCalendarData: string): CalendarEvent {
  const jcalData = ICAL.parse(iCalendarData);
  const vcalendar = new ICAL.Component(jcalData);
  const vevent: ICAL.Component | null= vcalendar.getFirstSubcomponent('vevent');
  if (!vevent) throw new Error('No vevent found');
  const event = new ICAL.Event(vevent);
  const dtstart= vevent.getFirstPropertyValue('dtstart');
  if (!dtstart) throw new Error('No dtstart found');
  const tzid = (dtstart as any).timezone as string;
  const duration = {
      weeks: event.duration.weeks,
      days: event.duration.days,
      hours: event.duration.hours,
      minutes: event.duration.minutes,
      seconds: event.duration.seconds,
      isNegative: event.duration.isNegative
  }

  // if you try to add a event with `METHOD:REQUEST` in another calendar you will get `The HTTP 415 Unsupported Media Type` error.
  const iCalData = iCalendarData.replace('METHOD:REQUEST', '');

  const calendarEvent = {
      uid: event.uid,
      summary: event.summary,
      description: event.description,
      location: event.location,
      sequence: event.sequence,
      startDate: event.startDate.toJSDate(),
      endDate: event.endDate.toJSDate(),
      duration,
      organizer: event.organizer,
      recurrenceId: event.recurrenceId?.toUnixTime(),
      allDayEvent: isAllDayEvent(duration),
      tzid,
      iCalendarData: iCalData
  };
  return calendarEvent;
}

function isAllDayEvent(duration: CalendarEventDuration) {
  return duration.days === 1 &&
  duration.hours === 0 && 
  duration.minutes === 0 && 
  duration.seconds === 0 && 
  duration.weeks === 0 &&
  duration.isNegative === false;
}