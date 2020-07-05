import { Stories } from '../../../story/stories.collection';
import { Projects } from '../../../project/project.collection';
import { NLUModels } from '../../../nlu_model/nlu_model.collection';
import BotResponses from '../../botResponses/botResponses.model';

const combineSearches = (search, responseKeys, intents) => {
    const searchRegex = [search];
    if (responseKeys.length) searchRegex.push(responseKeys.join('|'));
    if (intents.length) searchRegex.push(intents.join('|'));
    return searchRegex.join('|');
};

export const searchStories = async (projectId, language, search) => {
    const project = Projects.findOne({ _id: projectId }, { fields: { nlu_models: 1 } });
    const nluModels = project.nlu_models;
    const searchRegex = new RegExp(search, 'i');
    const model = NLUModels.findOne(
        { _id: { $in: nluModels }, language },
    );
    const modelExamples = model.training_data.common_examples;
    const intents = modelExamples.reduce((filtered, option) => {
        if (searchRegex.test(option.text)) {
            return [...filtered, option.intent];
        }
        return filtered;
    }, []);
    const matchedResponses = await BotResponses.find(
        { textIndex: { $regex: search, $options: 'i' } },
    ).lean();
    const responseKeys = matchedResponses.map(({ key }) => key);
    const fullSearch = combineSearches(search, responseKeys, intents);
    const matched = Stories.find(
        {
            projectId,
            $or: [{ 'textIndex.info': { $regex: search, $options: 'i' } }, { 'textIndex.contents': { $regex: fullSearch, $options: 'i' } }],
        },
        {
            fields: {
                _id: 1, title: 1, storyGroupId: 1,
            },
        },
    ).fetch();
    return matched;
};

const replaceLine = (story, lineToReplace, newLine) => {
    // regexp: [ ] = space; + = any number of the characters in the []; $ = end of string
    const regex = new RegExp(`- ${lineToReplace}([ ]+\n|\n|[ ]+$|$)`, 'g');
    return story.replace(regex, `- ${newLine}\n`);
};
const replaceIndexLine = (index, lineToReplace, newLine) => {
    const regex = new RegExp(`(^|\n|[ ])${lineToReplace}(\n|$|[ ])`, 'g');
    return index.replace(regex, `\n${newLine}\n`);
};

const traverseReplaceLine = (story, lineToReplace, newLine) => {
    const updatedStory = story;
    updatedStory.story = replaceLine(updatedStory.story, lineToReplace, newLine);
    updatedStory.textIndex.contents = replaceIndexLine(updatedStory.textIndex.contents, lineToReplace, newLine);
    updatedStory.events = updatedStory.events.map(event => (event === lineToReplace ? newLine : event));
    updatedStory.branches.forEach((branch) => {
        traverseReplaceLine(branch, lineToReplace, newLine);
    });
    return updatedStory;
};

export const replaceStoryLines = (projectId, lineToReplace, newLine) => {
    const matchingStories = Stories.find(
        {
            projectId,
            $or: [{ 'textIndex.contents': { $regex: lineToReplace } }],

        },
        { fields: { _id: 1 } },
    ).fetch();
    return Promise.all(matchingStories.map(({ _id }) => {
        const story = Stories.findOne({ _id });
        const { _id: excludeId, ...rest } = traverseReplaceLine(story, lineToReplace, newLine);
        return Stories.update({ _id }, { $set: { ...rest } });
    }));
};
