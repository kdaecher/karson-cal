
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
  const [endDate, setEndDate] = createSignal(new Date(new Date().setHours(23, 59, 59, 999) + 7 * 24 * 60 * 60 * 1000)); // 7 days from now

  const [events] = createResource(
    () => {
      const client = ical_client();
      const cals = calendars();
      if (!client || !cals) return null;
      console.log(startDate(), endDate());
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

  const eventsByDay = createMemo(() => {
    const evts = events();
    if (!evts) return {};
    return evts.flat().reduce((acc, event) => {
      if (!event) return acc;
      const data = event.data;
      const parsedData = parseToCalendarEvent(data);
      const day = new Date(parsedData.startDate).toISOString().split('T')[0];
      acc[day] = acc[day] || [];
      acc[day].push(parsedData);
      return acc;
    }, {} as Record<string, CalendarEvent[]>);
  });

  const orderedDays = createMemo(() => Object.keys(eventsByDay() ?? {}).sort((a, b) => new Date(a).getTime() - new Date(b).getTime()));
  
  return (
    <>
      <input type="date" value={startDate().toISOString().split('T')[0]} onInput={(e) => setStartDate(new Date(e.target.value + 'T00:00:00'))} />
      <input type="date" value={endDate().toISOString().split('T')[0]} onInput={(e) => setEndDate(new Date(e.target.value + 'T00:00:00'))} />
      <div style={{ display: 'flex', "flex-direction": 'row', gap: '10px'}}>
        <For each={orderedDays()}>
          {(day) => (
            <div>
              <p>{new Date(day).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'numeric', day: 'numeric' })}</p>
              <div style={{ display: 'flex', "flex-direction": 'column', gap: '10px', border: '1px solid black', padding: '10px'}}>
                <For each={eventsByDay()[day]}>
                  {(event) => 
                    <div>
                      {event.startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: 'numeric' })} - {event.endDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: 'numeric', hour12: true })} {event.summary}
                    </div>
                  }
                </For>
              </div>
            </div>
          )}
        </For>
      </div>
    </>
  );
}

export default App


/** adapted from [simple-caldav-client](https://github.com/TheJLifeX/simple-caldav-client) */
function parseToCalendarEvent(iCalendarData: string): CalendarEvent {
  const jcalData = ICAL.parse(iCalendarData);
  const vcalendar = new ICAL.Component(jcalData);
  const vevent = vcalendar.getFirstSubcomponent('vevent');
  const event = new ICAL.Event(vevent);
  const tzid = vcalendar.getFirstSubcomponent('vtimezone') ? vcalendar.getFirstSubcomponent('vtimezone').getFirstPropertyValue('tzid') : 'Europe/Berlin';
  const duration = {
      weeks: event.duration.weeks,
      days: event.duration.days,
      hours: event.duration.hours,
      minutes: event.duration.minutes,
      seconds: event.duration.seconds,
      isNegative: event.duration.isNegative
  }
  const attendees = [];
  event.attendees.forEach((value) => {
      attendees.push(value.getValues());
  });

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
      attendees,
      recurrenceId: event.recurrenceId,
      allDayEvent: isAllDayEvent(duration),
      tzid,
      iCalendarData: iCalData
  };
  return calendarEvent;
}

function isAllDayEvent(duration: CalendarEventDuration) {
  return duration.days === 1 && duration.hours === 0 && duration.minutes === 0 && duration.seconds === 0 && duration.weeks === 0;
}