import express from "express";
import productRouter from "./routes/mongodb/products.routes.js";
import productsRouterView from "./routes/views/products.routes.js";
import cartRouter from "./routes/mongodb/carts.routes.js";
import env from "./config/env.js";
import { Server } from "socket.io";
import mongoose from "mongoose";
import messageManager from "./dao/managers/mongodb/messages.js";
import connectMongoDB from "connect-mongo";
import __dirname from "./utils/index.js";

import errorHandler from "./middleware.errors/index.js";

import passportSocketIo from "passport.socketio";
import cookieParser from "cookie-parser";

import * as http from "http";

import handlebars from "express-handlebars";
import Handlebars from "handlebars";
import { allowInsecurePrototypeAccess } from "@handlebars/allow-prototype-access";

import session from "express-session";
import morgan from "morgan";

import chatRouter from "./routes/chat.routes.js";
import authRouterView from "./routes/views/auth.routes.js";

//passport
import initializePassport from "./config/passport.js";
import passport from "passport";
import compression from "express-compression";
import productsMock from "./routes/mongodb/products.mock.routes.js";

// save express framework
const app = express();

// server http
const server = http.createServer(app);

// inicialize web sockets
const io = new Server(server);

// connect to mongodb
const mongoUrl = env.MONGO_URL;

await mongoose
  .connect(mongoUrl)
  .then(() => {
    console.log("DB CONNECTED");
  })
  .catch((e) => {
    console.log("Error connecting to database");
  });

const message = new messageManager();

// config mongodb
const store = connectMongoDB.create({
  mongoUrl: env.MONGO_URL,
  ttl: 3600,
});

app.use(
  compression({
    brotli: { enabled: true, zlig: {} },
  })
);

app.use(
  session({
    store,
    secret: "lilianaforero",
    resave: false,
    saveUninitialized: true,
  })
);

// Inicialize passport
initializePassport();
app.use(passport.initialize());
app.use(passport.session());

app.use((req, res, next) => {
  res.locals.userIsAuthenticated = req.isAuthenticated();

  let cart = null;
  if (req.isAuthenticated()) cart = req.user.cart;
  res.locals.cart = cart;

  let isAdmin = null;
  if (req.isAuthenticated()) isAdmin = req.user.role === "admin";
  res.locals.isAdmin = isAdmin;

  let user = null;
  if (req.isAuthenticated()) user = req.user;
  res.locals.user = user;
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));

// config handlebars
app.engine(
  "handlebars",
  handlebars.engine({
    handlebars: allowInsecurePrototypeAccess(Handlebars),
    helpers: {
      jsonify: function (context) {
        return JSON.stringify(context);
      },
    },
  })
);
app.set("view engine", "handlebars");
app.set("views", `${__dirname}/views`);

// public path
app.use("/", express.static(__dirname + "/public"));

// -- routes
// apis
app.use("/api/carts", cartRouter);
app.use("/api/products", productRouter);
//web
app.use("/chat", chatRouter);
app.use("/products", productsRouterView);
app.use("/auth", authRouterView);

// Mocking
app.use("/mockingproducts", productsMock);

app.use(errorHandler);

app.use('/', (req, res) => res.redirect('/products'));

// config port
const port = env.PORT;
server.listen(port, () => {
  console.log(`SERVER ON PORT: ${port}`);
});

io.use(
  passportSocketIo.authorize({
    cookieParser,
    key: "connect.sid", // El nombre de la cookie de sesión
    secret: "lilianaforero",
    store, // Reemplaza esto con tu propio almacenamiento de sesiones
  })
);

let connectedUsers = 0;

// config socket
io.on("connection", (socket) => {
  console.log("Nuevo usuario conectado", socket.id);

  connectedUsers++;
  io.emit("userCount", connectedUsers);

  socket.on("newUser", (user) => {
    io.emit("currentUser", socket.request.user);
  });

  socket.on("chat:open", async () => {
    io.emit("currentUser", socket.request.user);
    const allMessages = await message.getAll();
    const messages = allMessages.map((m) => {
      return {
        user: {
          _id: m.user._id,
          firstName: m.user.firstName,
          lastName: m.user.lastName,
          email: m.user.email,
        },
        message: m.message,
        date: m.date,
      };
    });
    io.emit("messages", messages);
  });

  socket.on("chat:message", async (msg) => {
    const user = socket.request.user;
    msg = {
      user: user._id,
      message: msg.message,
    };
    await message.save(msg);
    const allMessages = await message.getAll();
    const messages = allMessages.map((m) => {
      return {
        user: {
          _id: m.user._id,
          firstName: m.user.firstName,
          lastName: m.user.lastName,
          email: m.user.email,
        },
        message: m.message,
        date: m.date,
      };
    });
    io.emit("messages", messages);
  });

  socket.on("newUser", (user) => {
    socket.broadcast.emit("newUser", user);
  });

  socket.on("chat:typing", (data) => {
    socket.broadcast.emit("chat:typing", data);
  });

  socket.on("disconnect", () => {
    connectedUsers--;
    console.log("usuario desconectado", socket.id);
    io.emit("userCount", connectedUsers);
  });
});
