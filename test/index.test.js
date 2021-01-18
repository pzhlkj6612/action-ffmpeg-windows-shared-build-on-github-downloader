const { when } = require("jest-when");


const mockCore = {
    getInput: jest.fn(),
    setOutput: jest.fn(),
    setFailed: jest.fn()
};

/*
const text = core.getInput("url");
const target = core.getInput("target");
let autoMatch = core.getInput("auto-match");
*/

when(mockCore.getInput)
    .calledWith("url")
    .mockReturnValueOnce("http://example.com/index.html")
    .mockReturnValueOnce("https://httpbin.org/status/400")
    .mockReturnValueOnce("https://httpbin.org/status/403")
    .mockReturnValueOnce("https://httpbin.org/status/404")
    .mockReturnValueOnce("https://httpbin.org/status/500")
    .mockReturnValueOnce("https://httpbin.org/status/502")
    .calledWith("target")
    .mockReturnValue("./")
    .calledWith("autoMatch")
    .mockReturnValue("false");


jest.doMock("@actions/core", () => mockCore);
const core = require("@actions/core")

const index = require("../index");

const getFilenameFromUrl = index.getFilenameFromUrl;

test("Function getFilenameFromUrl: Should get the filename", () => {
    expect(getFilenameFromUrl("https://example.com/file.ext")).toEqual("file.ext");
    expect(getFilenameFromUrl("https://example.com/file.ext?arg=")).toEqual("file.ext");
    expect(getFilenameFromUrl("https://example.com/file.ext#anchor")).toEqual("file.ext");
});

const main = index.main;



beforeEach(() => {
    jest.resetAllMocks();
})

test("Should load", () => {
    expect(main).not.toBeNull();
});

test("Function main", () => {
    // when(mockCore.getInput).calledWith("url").mockReturnValue("http://example.com/index.html");
    // when(mockCore.getInput).calledWith("target").mockReturnValue("./");
    // when(mockCore.getInput).calledWith("autoMatch").mockReturnValue("false");

    // mockCore.getInput.mockReturnValue("http://example.com/index.html");
    main();

    console.log("???");
    mockCore.getInput.mock.calls.forEach(element => {
        console.log(element);
    });

    expect(mockCore.getInput).toBeCalled();
    expect(mockCore.setFailed).toBeCalled();
    expect(mockCore.setOutput).toBeCalled();
    console.log(mockCore.getInput.mock.calls);
    console.log(mockCore.setFailed.mock.calls);
    console.log(mockCore.setOutput.mock.calls);
    expect(mockCore.setOutput).toHaveBeenCalledWith("filename", "index.html");
});
