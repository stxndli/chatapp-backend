const express = require('express');
const http = require('http');
const bcrypt = require('bcrypt');
const socketIO = require('socket.io');
const bodyParser = require("body-parser");
const cors = require('cors');
const mysql = require('mysql');
const app = express();
const auth = require("./auth");
const jwt = require('jsonwebtoken')
const cookieParser = require('cookie-parser');
require('dotenv').config()
app.use(bodyParser.json());
app.use(cookieParser());
app.use(cors({
  origin: process.env.FRONTEND_HOST
}));
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: process.env.FRONTEND_HOST,
  }
});

// database connection
const con = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB
});
con.connect(function(err) {
  if (err) throw err;
  console.log("DB Connected!");
});


io.on('connection', (socket) => {
  const username = socket.handshake.query.user
  socket.join(`${username}`)
  if (username) {
    const query = `SELECT room FROM usersRooms WHERE user='${username}'`
    con.query(query, (err, result) => {
      if (err) return
      result.forEach(row => {
        socket.join(`${row.room}`)
      });
    })
  }
  socket.on('message', (room, message) => {
    io.to(`${room}`).emit('message', message);
  });
});


const roomsUpdate = (user, room) => {
  const query = `SELECT socketId FROM users WHERE username='${user}'`
  con.query(query, async (err, result) => {
    if (err) console.log(err)
    if (result) {
      const socketsInServer = await io.fetchSockets()
      result.forEach(row => {
        const socket = socketsInServer.find(s => s.id === row.socketId) // find soket object using socket id
        if (socket) {
          socket.join(`${room}`)
          io.to(`${user}`).emit('addedToRoom', `${room}`)
        }
      })
    }
  })
}

const serverErr = (res) => res.status(500).json({ message: "An error occured, try again later" })


app.post("/login", (req, res) => {
  const { username, password } = req.body
  const query = `SELECT * FROM users WHERE username = '${username}'`
  con.query(query, (err, result) => {
    if (err) {
      return serverErr(res)
    }
    else {
      if (!result.length) {
        res.status(400).json({ message: "User not Found" })
      }
      else {
        bcrypt.compare(password, result[0].password, function(err, success) {
          if (err) return serverErr(res)
          if (success) {
            const token = jwt.sign(
              { username: username },
              process.env.TOKEN_KEY,
              { expiresIn: "2h" }
            )
            res.status(200).json({ token: token })
          }
          else {
            res.status(403).json({ message: "Incorrect password" })
          }

        });
      }
    }
  })
})

app.post("/signup", (req, res) => {
  const { username, password } = req.body
  if (!username || !password) res.status(400).json({ message: "All inputs are required" })
  const query = `SELECT * FROM users WHERE username = '${username}'`
  con.query(query, (err, result) => {
    if (err) return serverErr(res)
    else {
      if (result.length) {
        res.status(409).json({ message: "Username already exists" })
      }
      else {
        const saltRounds = 10
        bcrypt.hash(password, saltRounds, function(err, hash) {
          if (err) return serverErr(res)
          const token = jwt.sign(
            { username: username },
            process.env.TOKEN_KEY,
            { expiresIn: "2h" }
          )
          const insertQuery = `INSERT INTO users (username, password) VALUES ('${username}', '${hash}')`
          con.query(insertQuery, (insertErr) => {
            if (insertErr) return serverErr(res)
            else {
              res.status(200).json({ token: token })
            }
          })

        });
      }
    }
  })
})

app.get("/verifyToken", auth, (req, res) => {
  return res.status(200).json({ user: req.user })
})

app.post("/userSocket", auth, (req, res) => {
  const { user, socketId } = req.body
  const query = `UPDATE users SET socketId = '${socketId}' WHERE username='${user}'`
  con.query(query, (err, result) => {
    if (err) return serverErr(res)
    res.status(200).json({ message: "socketId updated " })
  })
})

app.post("/createRoom", auth, (req, res) => {
  let error = false
  const { name, users } = req.body;
  const insert = `INSERT INTO rooms (name) VALUES ("${name}")`;
  con.query(insert, function(err, result) {
    if (err) {
      error = true
      return
    }
    else {
      const { insertId } = result
      users.forEach(user => {
        const query = `INSERT INTO usersRooms (room, user) VALUES ('${insertId}', '${user}')`
        con.query(query, (err) => {
          if (err) error = true
          else roomsUpdate(user, insertId)
        })
      });
    }
  });
  if (error) return serverErr(res)
  res.status(200).json({ message: "Room created" })

});
app.get("/messages", auth, (req, res) => {
  const { room, limit } = req.query
  const { username } = req.user
  const checkUser = `SELECT * FROM usersRooms WHERE room=${room} AND user='${username}'`
  con.query(checkUser, (err, result) => {
    if (err) return serverErr(res)
    if (result.length === 0) return res.status(300).json({ message: "User not in room" })
    let query
    if (limit) query = `SELECT * FROM messages WHERE room='${room}' ORDER BY ID DESC LIMIT 1`
    else query = `SELECT * FROM messages WHERE room='${room}'`
    con.query(query, (err, result) => {
      if (err) return serverErr(res)
      res.status(200).json({ data: result })
    })
  })
})

app.post("/message", (req, res) => {
  const { room, from, content } = req.body
  query = `INSERT INTO messages (room, \`from\`, content) VALUES ('${room}', '${from}', '${content}')`
  con.query(query, (err, result) => {
    if (err) return serverErr(res)
    res.status(200).json({ message: "Success" })
  })
})

app.get("/userInRoom", auth, (req, res) => {
  const { room } = req.query
  const username = req.user.username
  const query = `SELECT * FROM usersRooms WHERE room='${room}' AND user='${username}'`
  con.query(query, (err, result) => {
    if (err) return serverErr(res)
    if (result.length === 0) return res.status(404).json({ message: "User not found" })
    return res.status(200).json({ message: "User found" })
  })
})

app.get("/roomsByUser", auth, (req, res) => {
  const username = req.user.username
  const query = `SELECT * FROM usersRooms WHERE user='${username}'`
  con.query(query, (err, result) => {
    if (err) return serverErr(res)
    return res.status(200).json({ data: result })
  })
})

app.get("/room", auth, (req, res) => {
  const { room } = req.query
  const username = req.user.username
  const checkQuery = `SELECT * FROM usersRooms WHERE user='${username}' AND room=${room}`
  con.query(checkQuery, (err, result) => {
    if (err) { return serverErr(res) }
    if (result.length === 0) return res.status(300).json({ message: "Not Authorized" })
    const query = `SELECT * FROM rooms WHERE id=${room}`
    con.query(query, (err, result) => {
      if (err) { return serverErr(res) }

      return res.status(200).json({ data: result })
    })
  })
})

app.get("/user", auth, (req, res) => {
  const { username } = req.query
  const query = `SELECT * FROM users WHERE username='${username}'`
  con.query(query, (err, result) => {
    if (err) return serverErr(res)
    if (result.length === 0) return res.status(404).json({ message: "User not found" })
    return res.status(200).json({ message: "User found" })
  })
})
server.listen(process.env.PORT, () => {
  console.log(`Server listening on port ${process.env.PORT}`);
});
