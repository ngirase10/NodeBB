import _ from 'lodash';

import db from '../database';
import user from '../user';
import privileges from '../privileges';
import search from '../search';

interface Topic {
    tid: number;
    timestamp: number;
}

interface TopicData {
    title: string;
    cid: number;

}

interface Topics {
    getTopicTags(tid: number): Promise<string[]>;
    getSortedSetRevRange(keys: string[], start: number, stop: number): Promise<number[]>;
    // eslint-disable-next-line max-len
    getSortedSetRevRangeByScore(keys: string[], start: number, stop: number, score: string, end: number): Promise<number[]>;
    getTopicFields(tid: number, fields: string[]): Promise<TopicData>;
    getTopicsByTids(tids: number[], uid: number): Promise<Topic[]>;
    getTopicField(tid: number, field: string): Promise<number | string>;
    getTidsWithSameTags(tid: number, cutoff: number): Promise<number[]>;
    getSearchTids(tid: number, uid: number, cutoff: number): Promise<number[]>;
    getCategoryTids(tid: number, cutoff: number): Promise<number[]>;
    getSuggestedTopics(tid: number, uid: number, start: number, stop: number, cutoff: number): Promise<Topic[]>;
}

export = function (Topics: Topics) {
    async function getTidsWithSameTags(tid: number, cutoff: number) {
        const tags: string[] = await Topics.getTopicTags(tid);
        let tids: number[];
        if (cutoff === 0) {
            // The next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            const tids: number[] = await db.getSortedSetRevRange(tags.map(tag => `tag:${tag}:topics`), 0, -1) as number[];
        } else {
            // The next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            const tids: number[] = await db.getSortedSetRevRangeByScore(tags.map(tag => `tag:${tag}:topics`), 0, -1, '+inf', Date.now() - cutoff) as number[];
        }
        const tidsFiltered = tids.filter(_tid => _tid !== tid); // remove self
        return _.shuffle(_.uniq(tidsFiltered)).slice(0, 10).map(Number);
    }
    async function getSearchTids(tid: number, uid: number, cutoff: number) {
        const topicData: TopicData = await Topics.getTopicFields(tid, ['title', 'cid']);
        const data = await search.search({
            query: topicData.title,
            searchIn: 'titles',
            matchWords: 'any',
            categories: [topicData.cid],
            uid: uid,
            returnIds: true,
            timeRange: cutoff !== 0 ? cutoff / 1000 : 0,
            timeFilter: 'newer',
        }) as { tids: number[] };
        data.tids = data.tids.filter(_tid => _tid !== tid); // remove self
        return _.shuffle(data.tids).slice(0, 10).map(Number);
    }

    async function getCategoryTids(tid: number, cutoff: number) {
        const cid: number = await Topics.getTopicField(tid, 'cid') as number;
        const tids: number[] = cutoff === 0 ?
            // The next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            await db.getSortedSetRevRange([`cid:${cid}:tids:lastposttime`], 0, 9) as number [] :
            // The next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            await db.getSortedSetRevRangeByScore([`cid:${cid}:tids:lastposttime`], 0, 9, '+inf', Date.now() - cutoff) as number[];
        return _.shuffle(tids.map(Number).filter(_tid => _tid !== tid));
    }

    // eslint-disable-next-line max-len
    Topics.getSuggestedTopics = async function (tid :number, uid :number, start :number, stop :number, cutoff = 0): Promise<Topic[]> {
        let tids: number[];
        tid = parseInt(tid.toString(), 10);
        cutoff = cutoff === 0 ? cutoff : (cutoff * 2592000000);
        const [tagTids, searchTids] = await Promise.all([
            getTidsWithSameTags(tid, cutoff),
            getSearchTids(tid, uid, cutoff),
        ]);

        tids = _.uniq(tagTids.concat(searchTids));

        let categoryTids: number[] = [];
        if (stop !== -1 && tids.length < stop - start + 1) {
            categoryTids = await getCategoryTids(tid, cutoff);
        }
        tids = _.shuffle(_.uniq(tids.concat(categoryTids)));
        tids = await privileges.topics.filterTids('topics:read', tids, uid) as number[];

        let topicData: Topic[] = await Topics.getTopicsByTids(tids, uid);
        topicData = topicData.filter(topic => topic && topic.tid !== tid);
        // The next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        topicData = await (user.blocks.filter(uid, topicData));
        topicData = topicData.slice(start, stop !== -1 ? stop + 1 : undefined)
            .sort((t1, t2) => t2.timestamp - t1.timestamp);
        return topicData;
    };
}
